import type { Express } from "express";
import { storage } from "./storage";
import { db } from "./db";
import { users, schools, students, feeRecords, paymentRecords, notificationConfig, dunningLog, dunningTemplates, externalPaymentSettings, feeStructures } from "@shared/schema";
import { and, eq, sql, desc } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import Razorpay from "razorpay";

export function registerFeesRoutes(app: Express) {

  function adminGuard(req: any, res: any): boolean {
    if (!req.session?.userId || req.session.userRole !== "admin") {
      res.status(403).json({ message: "Admin access required" });
      return false;
    }
    if (!req.session.schoolId) {
      res.status(403).json({ message: "No school in session" });
      return false;
    }
    return true;
  }

  async function appendAudit(
    req: any,
    schoolId: number,
    action: string,
    entityType: string,
    entityId: number | null,
    description: string,
  ) {
    try {
      const forwarded = req.headers["x-forwarded-for"] as string | undefined;
      const ip = forwarded?.split(",")[0]?.trim() ?? req.socket?.remoteAddress ?? null;
      // Fetch actor name lazily
      let actorName: string | null = null;
      if (req.session?.userId) {
        const [u] = await db.select({ email: users.email }).from(users)
          .where(eq(users.id, req.session.userId));
        actorName = u?.email ?? `User #${req.session.userId}`;
      }
      await storage.appendFeeAuditLog({
        schoolId,
        actorId: req.session?.userId ?? null,
        actorName,
        ipAddress: ip,
        action,
        entityType,
        entityId,
        description,
      });
    } catch {/* non-critical */ }
  }

  // ── GET /api/admin/fees/summary ───────────────────────────────────────────
  app.get("/api/admin/fees/summary", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const viewSessionId: number | null = (req as any).viewSessionId ?? null;
    const sessionFilter = viewSessionId ?? (await storage.getActiveSession(schoolId))?.id ?? null;
    const summary = await storage.getFeeSummary(schoolId, sessionFilter);
    res.json(summary);
  });

  // ── Fee Structures ────────────────────────────────────────────────────────

  const breakdownItemSchema = z.object({
    name:    z.string().min(1).max(100),
    purpose: z.string().max(300).default(""),
    amount:  z.number().int().min(0),
  });

  const structureBodySchema = z.object({
    name: z.string().min(1).max(100),
    feeType: z.string().min(1).max(100),
    amount: z.number().int().positive(),
    frequency: z.enum(["monthly", "quarterly", "annual", "one-time"]),
    applicableClasses: z.array(z.string()).default([]),
    concessionType: z.enum(["none", "sibling", "merit", "other"]).default("none"),
    concessionPercent: z.number().int().min(0).max(100).default(0),
    dueDayOfMonth: z.number().int().min(1).max(31).optional().nullable(),
    isActive: z.boolean().default(true),
    breakdown: z.array(breakdownItemSchema).default([]),
    autoGenerate: z.boolean().default(false),
    autoGenDueDay: z.number().int().min(1).max(31).optional().nullable(),
  });

  app.get("/api/admin/fees/structures", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const structures = await storage.getFeeStructuresBySchool(req.session.schoolId!);
    res.json(structures);
  });

  app.post("/api/admin/fees/structures", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const parsed = structureBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    const schoolId = req.session.schoolId!;
    const rec = await storage.createFeeStructure({ ...parsed.data, schoolId, createdBy: req.session.userId });
    await appendAudit(req, schoolId, "create", "fee_structure", rec.id, `Created fee structure: ${rec.name} (₹${rec.amount})`);
    res.status(201).json(rec);
  });

  app.patch("/api/admin/fees/structures/:id", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const parsed = structureBodySchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    const schoolId = req.session.schoolId!;
    const updated = await storage.updateFeeStructure(id, schoolId, parsed.data);
    if (!updated) return res.status(404).json({ message: "Fee structure not found" });
    await appendAudit(req, schoolId, "update", "fee_structure", id, `Updated fee structure: ${updated.name}`);
    res.json(updated);
  });

  app.delete("/api/admin/fees/structures/:id", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const schoolId = req.session.schoolId!;
    const deleted = await storage.deleteFeeStructure(id, schoolId);
    if (!deleted) return res.status(404).json({ message: "Fee structure not found" });
    await appendAudit(req, schoolId, "delete", "fee_structure", id, `Deleted fee structure #${id}`);
    res.json({ success: true });
  });

  // ── Offline Payment Records ───────────────────────────────────────────────

  const paymentBodySchema = z.object({
    feeRecordId: z.number().int().positive().optional().nullable(),
    studentId: z.number().int().positive(),
    // Fee record fields — used to auto-create a fee record when feeRecordId is null
    feeType: z.string().min(1).max(100).optional().nullable(),
    dueDate: z.string().optional().nullable(),
    feeStatus: z.enum(["Due","Paid","Partial","Overdue","Waived"]).optional().nullable(),
    academicYear: z.string().max(20).optional().nullable(),
    feeNotes: z.string().max(500).optional().nullable(),
    // Payment fields
    paymentMethod: z.enum(["Cash", "Cheque", "BankTransfer", "DemandDraft", "Online"]),
    referenceNumber: z.string().max(100).optional().nullable(),
    receivedDate: z.string().min(1),
    amount: z.number().int().positive(),
    cashierNotes: z.string().max(500).optional().nullable(),
    idempotencyKey: z.string().max(64).optional().nullable(),
    adminPassword: z.string().optional(),
  });

  app.get("/api/admin/fees/payments", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const { studentId, feeRecordId } = req.query as { studentId?: string; feeRecordId?: string };
    const viewSessionId: number | null = (req as any).viewSessionId ?? null;
    const sessionFilter = viewSessionId ?? (await storage.getActiveSession(schoolId))?.id ?? null;
    const opts: { studentId?: number; feeRecordId?: number; sessionId?: number | null } = {};
    if (studentId) opts.studentId = parseInt(studentId);
    // When fetching for a specific fee record, skip session filter (receipt lookup by ID)
    if (feeRecordId) opts.feeRecordId = parseInt(feeRecordId);
    else opts.sessionId = sessionFilter;
    const records = await storage.getPaymentRecordsBySchool(schoolId, opts);
    res.json(records);
  });

  app.post("/api/admin/fees/payments", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const parsed = paymentBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });

    const { adminPassword, idempotencyKey, ...paymentData } = parsed.data;

    // High-value re-auth (>= ₹10,000)
    if (paymentData.amount >= 10000) {
      if (!adminPassword) {
        return res.status(402).json({ message: "High-value payment requires admin password confirmation", requiresConfirm: true });
      }
      const [user] = await db.select({ passwordHash: users.passwordHash }).from(users)
        .where(eq(users.id, req.session.userId!));
      if (!user?.passwordHash || !(await bcrypt.compare(adminPassword, user.passwordHash))) {
        return res.status(403).json({ message: "Incorrect admin password" });
      }
    }

    // Tenant ownership: verify studentId belongs to this school
    const [studentCheck] = await db.select({ id: students.id })
      .from(students)
      .where(and(eq(students.id, paymentData.studentId), eq(students.schoolId, schoolId)));
    if (!studentCheck) return res.status(400).json({ message: "Student does not belong to this school" });

    // Tenant ownership: verify feeRecordId belongs to this school (and matches the student)
    if (paymentData.feeRecordId) {
      const [recCheck] = await db.select({ id: feeRecords.id, studentId: feeRecords.studentId })
        .from(feeRecords)
        .where(and(eq(feeRecords.id, paymentData.feeRecordId), eq(feeRecords.schoolId, schoolId)));
      if (!recCheck) return res.status(400).json({ message: "Fee record does not belong to this school" });
      if (recCheck.studentId !== paymentData.studentId) {
        return res.status(400).json({ message: "Fee record does not belong to the specified student" });
      }
    }

    // Idempotency guard — scoped by school to prevent cross-tenant key collisions
    if (idempotencyKey) {
      const existing = await storage.getPaymentRecordByIdempotencyKey(idempotencyKey, schoolId);
      if (existing) return res.status(200).json({ ...existing, idempotent: true });
    }

    // Generate a non-reusable OP receipt number BEFORE the transaction so
    // the sequence counter is always consumed even if the transaction rolls
    // back (e.g. due to a server crash or DB error mid-payment).
    //
    // WHY intentional pre-transaction consumption:
    //   • Uniqueness guarantee — the counter is incremented atomically at the
    //     DB level (INSERT … ON CONFLICT DO UPDATE).  Doing this inside the
    //     payment transaction would mean a rolled-back attempt could leave a
    //     "phantom" counter increment that causes the NEXT request (which
    //     reuses the same idempotency key) to get a new number instead of
    //     the idempotency-cached one.  Pre-incrementing avoids that race.
    //   • Idempotency — retried requests are caught by the idempotency-key
    //     guard above and return the already-committed record; they never
    //     reach this line a second time.
    //
    // CONSEQUENCE — GAPS IN OP NUMBERS ARE EXPECTED:
    //   If the DB transaction below rolls back after this point (network
    //   drop, server restart, overpayment guard exit, etc.) the OP number
    //   is permanently consumed but never stored anywhere.  The next
    //   successful payment will carry the following number.  These gaps do
    //   NOT represent missing or duplicate payments — they are a deliberate
    //   side-effect of the uniqueness guarantee.  Accountants auditing the
    //   OP sequence should treat non-consecutive numbers as normal.
    const opReceipt = await storage.nextReceiptNumber(schoolId, "OP");

    // Auto-create a fee record when none is pre-linked but fee details were supplied
    if (!paymentData.feeRecordId && paymentData.feeType) {
      // Class-restriction guard: if a fee structure exists for this feeType and has
      // applicableClasses, reject the payment if the student is not in those classes.
      const allStructures = await storage.getFeeStructuresBySchool(schoolId);
      const matchingStructure = allStructures.find(
        s => s.feeType.trim().toLowerCase() === paymentData.feeType!.trim().toLowerCase()
          && (s as any).isActive !== false,
      );
      if (matchingStructure) {
        const applicableClasses: string[] = (matchingStructure as any).applicableClasses ?? [];
        if (applicableClasses.length > 0) {
          const student = await storage.getStudentById(paymentData.studentId);
          const studentClass = student?.class ?? "";
          if (!applicableClasses.includes(studentClass)) {
            return res.status(400).json({
              message: `This fee type ("${paymentData.feeType}") is only applicable to classes: ${applicableClasses.join(", ")}. This student's class (${studentClass || "unknown"}) is not in the list.`,
            });
          }
        }
      }

      const viewSessionId: number | null = (req as any).viewSessionId ?? null;
      const autoFeeRecord = await storage.createFeeRecord({
        studentId: paymentData.studentId,
        schoolId,
        sessionId: viewSessionId,
        feeType: paymentData.feeType,
        amount: paymentData.amount,
        dueDate: paymentData.dueDate ?? paymentData.receivedDate,
        status: paymentData.feeStatus ?? "Due",
        academicYear: paymentData.academicYear ?? null,
        notes: paymentData.feeNotes ?? null,
        createdBy: req.session.userId,
      });
      paymentData.feeRecordId = autoFeeRecord.id;
    }

    // Destructure out fee-record-only fields before passing to createPaymentRecord
    const { feeType: _ft, dueDate: _dd, feeStatus: _fs, academicYear: _ay, feeNotes: _fn, ...paymentOnly } = paymentData;

    // ── Atomic overpayment guard + payment insert (configurable soft cap) ─────
    // The entire check-then-insert runs inside one DB transaction with a
    // SELECT … FOR UPDATE row lock on the fee record.  A concurrent request for
    // the same fee record will block at the lock until this transaction commits,
    // guaranteeing the sum it reads is fully up-to-date and the cap cannot be
    // breached by two near-simultaneous submissions.
    const feesSettings = await storage.getExternalPaymentSettings(schoolId);
    const configuredPercent = feesSettings?.maxOvercollectionPercent ?? 150;
    const OVERPAYMENT_FACTOR = configuredPercent / 100;
    let rec: any = null;
    let overpaymentBlock: {
      message: string; invoiceAmount: number; totalAlreadyPaid: number; newAmount: number;
    } | null = null;

    await db.transaction(async (tx) => {
      if (paymentOnly.feeRecordId) {
        // Acquire a row-level write lock — concurrent requests will queue here.
        const lockResult = await tx.execute(
          sql`SELECT amount FROM fee_records
              WHERE id = ${paymentOnly.feeRecordId} AND school_id = ${schoolId}
              FOR UPDATE`,
        );
        const lockedFee = lockResult.rows[0] as { amount: number } | undefined;

        if (lockedFee) {
          const sumResult = await tx.execute(
            sql`SELECT COALESCE(SUM(amount), 0)::int AS existing_paid
                FROM payment_records
                WHERE fee_record_id = ${paymentOnly.feeRecordId}`,
          );
          const totalAlreadyPaid = Number((sumResult.rows[0] as any)?.existing_paid) || 0;
          const cap = Math.round(lockedFee.amount * OVERPAYMENT_FACTOR);

          if (totalAlreadyPaid + paymentOnly.amount > cap) {
            overpaymentBlock = {
              message: `This payment (₹${paymentOnly.amount.toLocaleString("en-IN")}) would bring the total collected to ₹${(totalAlreadyPaid + paymentOnly.amount).toLocaleString("en-IN")}, which exceeds ${configuredPercent}% of the invoice amount (₹${lockedFee.amount.toLocaleString("en-IN")}). Please verify the amount and try again.`,
              invoiceAmount: lockedFee.amount,
              totalAlreadyPaid,
              newAmount: paymentOnly.amount,
            };
            return; // exit callback — transaction commits with no writes
          }
        }
      }

      // Resolve session ID (mirrors logic in storage.createPaymentRecord)
      let resolvedSessionId: number | null = null;
      if (paymentOnly.feeRecordId) {
        const sesRow = await tx.execute(
          sql`SELECT session_id FROM fee_records
              WHERE id = ${paymentOnly.feeRecordId} AND school_id = ${schoolId}`,
        );
        resolvedSessionId = (sesRow.rows[0] as any)?.session_id ?? null;
      }
      if (resolvedSessionId == null) {
        const activeRow = await tx.execute(
          sql`SELECT id FROM academic_sessions
              WHERE school_id = ${schoolId} AND is_active = true LIMIT 1`,
        );
        resolvedSessionId = (activeRow.rows[0] as any)?.id ?? null;
      }

      // Insert payment record inside the same transaction
      const insertResult = await tx.execute(
        sql`INSERT INTO payment_records
              (school_id, session_id, fee_record_id, student_id, payment_method,
               reference_number, received_date, amount, cashier_notes,
               idempotency_key, recorded_by, receipt_number)
            VALUES (
              ${schoolId},
              ${resolvedSessionId},
              ${paymentOnly.feeRecordId ?? null},
              ${paymentOnly.studentId},
              ${paymentOnly.paymentMethod},
              ${paymentOnly.referenceNumber ?? null},
              ${paymentOnly.receivedDate},
              ${paymentOnly.amount},
              ${paymentOnly.cashierNotes ?? null},
              ${idempotencyKey ?? null},
              ${req.session.userId ?? null},
              ${opReceipt}
            )
            RETURNING *`,
      );
      rec = insertResult.rows[0];

      // Auto-update linked fee record status (sum includes the row just inserted)
      if (paymentOnly.feeRecordId && rec) {
        const feeRow = await tx.execute(
          sql`SELECT amount FROM fee_records
              WHERE id = ${paymentOnly.feeRecordId} AND school_id = ${schoolId}`,
        );
        const linkedFee = feeRow.rows[0] as { amount: number } | undefined;
        if (linkedFee) {
          const paidRow = await tx.execute(
            sql`SELECT COALESCE(SUM(amount), 0)::int AS total_paid
                FROM payment_records
                WHERE fee_record_id = ${paymentOnly.feeRecordId}`,
          );
          const totalPaid = Number((paidRow.rows[0] as any)?.total_paid) || 0;
          const newStatus = totalPaid >= linkedFee.amount ? "Paid" : "Partial";
          await tx.execute(
            sql`UPDATE fee_records
                SET status = ${newStatus},
                    paid_date = ${paymentOnly.receivedDate},
                    receipt_number = ${opReceipt}
                WHERE id = ${paymentOnly.feeRecordId} AND school_id = ${schoolId}`,
          );
        }
      }
    });
    // ─────────────────────────────────────────────────────────────────────────

    if (overpaymentBlock) {
      await appendAudit(
        req, schoolId, "blocked_payment", "payment_record", paymentOnly.feeRecordId ?? null,
        `Blocked overpayment attempt: ₹${overpaymentBlock.newAmount.toLocaleString("en-IN")} attempted for student #${paymentOnly.studentId} — invoice ₹${overpaymentBlock.invoiceAmount.toLocaleString("en-IN")}, already paid ₹${overpaymentBlock.totalAlreadyPaid.toLocaleString("en-IN")}, cumulative total would have been ₹${(overpaymentBlock.totalAlreadyPaid + overpaymentBlock.newAmount).toLocaleString("en-IN")}`,
      );
      return res.status(400).json({ ...overpaymentBlock, overpaymentGuard: true });
    }

    await appendAudit(req, schoolId, "payment", "payment_record", rec?.id ?? null,
      `Recorded ${paymentOnly.paymentMethod} ₹${paymentOnly.amount} for student #${paymentOnly.studentId} — receipt ${opReceipt}. Note: gaps in the OP receipt sequence are expected and do not indicate missing payments (pre-transaction counter consumption guarantees uniqueness).`);
    res.status(201).json(rec);
  });

  // ── External Payment Settings ─────────────────────────────────────────────

  const externalSettingsSchema = z.object({
    isEnabled: z.boolean(),
    gatewayUrl: z.string().max(500).optional().nullable(),
    bannerMessage: z.string().max(500).optional().nullable(),
    maxOvercollectionPercent: z.number().int().min(100).max(500).default(150),
    razorpayEnabled: z.boolean().default(false),
    razorpayKeyId: z.string().max(200).optional().nullable(),
    // Secret is optional — null means "leave unchanged" when masked placeholder is sent
    razorpayKeySecret: z.string().max(500).optional().nullable(),
    razorpayWebhookSecret: z.string().max(500).optional().nullable(),
    razorpayMode: z.enum(["test", "live"]).default("test"),
  });

  app.get("/api/admin/fees/external-settings", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const settings = await storage.getExternalPaymentSettings(req.session.schoolId!);
    if (!settings) {
      return res.json({ isEnabled: false, gatewayUrl: null, bannerMessage: null, maxOvercollectionPercent: 150,
        razorpayEnabled: false, razorpayKeyId: null, razorpayKeySecret: null, razorpayWebhookSecret: null, razorpayMode: "test" });
    }
    // Never return secrets in plaintext — mask them so the UI knows they're set
    res.json({
      ...settings,
      razorpayKeySecret: settings.razorpayKeySecret ? "••••••••" : null,
      razorpayWebhookSecret: settings.razorpayWebhookSecret ? "••••••••" : null,
    });
  });

  app.put("/api/admin/fees/external-settings", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const parsed = externalSettingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    const schoolId = req.session.schoolId!;
    const previous = await storage.getExternalPaymentSettings(schoolId);

    // Don't overwrite secrets if the frontend sent the masked placeholder back
    const keySecret = parsed.data.razorpayKeySecret === "••••••••" ? undefined : (parsed.data.razorpayKeySecret || null);
    const webhookSecret = parsed.data.razorpayWebhookSecret === "••••••••" ? undefined : (parsed.data.razorpayWebhookSecret || null);

    const updated = await storage.upsertExternalPaymentSettings(schoolId, {
      isEnabled: parsed.data.isEnabled,
      gatewayUrl: parsed.data.gatewayUrl || null,
      bannerMessage: parsed.data.bannerMessage || null,
      maxOvercollectionPercent: parsed.data.maxOvercollectionPercent,
      lastUpdatedBy: req.session.userId,
      razorpayEnabled: parsed.data.razorpayEnabled,
      razorpayKeyId: parsed.data.razorpayKeyId || null,
      ...(keySecret !== undefined ? { razorpayKeySecret: keySecret } : {}),
      ...(webhookSecret !== undefined ? { razorpayWebhookSecret: webhookSecret } : {}),
      razorpayMode: parsed.data.razorpayMode,
    });

    const auditParts: string[] = [];
    auditParts.push(`External payment portal ${parsed.data.isEnabled ? "enabled" : "disabled"}`);
    if (parsed.data.razorpayEnabled !== (previous?.razorpayEnabled ?? false))
      auditParts.push(`Razorpay ${parsed.data.razorpayEnabled ? "enabled" : "disabled"}`);
    if (parsed.data.razorpayKeyId && parsed.data.razorpayKeyId !== previous?.razorpayKeyId)
      auditParts.push(`Razorpay Key ID updated`);
    if (keySecret !== undefined) auditParts.push("Razorpay Key Secret updated");
    if (webhookSecret !== undefined) auditParts.push("Razorpay Webhook Secret updated");
    if (previous?.maxOvercollectionPercent !== parsed.data.maxOvercollectionPercent)
      auditParts.push(`Max over-collection cap: ${previous?.maxOvercollectionPercent ?? 150}% → ${parsed.data.maxOvercollectionPercent}%`);

    await appendAudit(req, schoolId, "settings_change", "external_settings", null, auditParts.join("; "));
    // Return with masked secrets
    res.json({
      ...updated,
      razorpayKeySecret: updated.razorpayKeySecret ? "••••••••" : null,
      razorpayWebhookSecret: updated.razorpayWebhookSecret ? "••••••••" : null,
    });
  });

  // ── Save Razorpay settings only ───────────────────────────────────────────
  const razorpaySettingsSchema = z.object({
    razorpayEnabled:       z.boolean(),
    razorpayKeyId:         z.string().max(200).optional().nullable(),
    razorpayKeySecret:     z.string().max(500).optional().nullable(),
    razorpayWebhookSecret: z.string().max(500).optional().nullable(),
    razorpayMode:          z.enum(["test", "live"]).default("test"),
  });

  app.put("/api/admin/fees/external-settings/razorpay", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const parsed = razorpaySettingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    const schoolId = req.session.schoolId!;
    const previous = await storage.getExternalPaymentSettings(schoolId);

    const keySecret     = parsed.data.razorpayKeySecret     === "••••••••" ? undefined : (parsed.data.razorpayKeySecret     || null);
    const webhookSecret = parsed.data.razorpayWebhookSecret === "••••••••" ? undefined : (parsed.data.razorpayWebhookSecret || null);

    // Validate: if enabling, Key ID must be present (new or existing)
    const effectiveKeyId = parsed.data.razorpayKeyId || previous?.razorpayKeyId || null;
    if (parsed.data.razorpayEnabled && !effectiveKeyId) {
      return res.status(400).json({ message: "Key ID is required before enabling Razorpay." });
    }

    const updated = await storage.upsertExternalPaymentSettings(schoolId, {
      // Preserve portal fields from previous settings
      isEnabled:                previous?.isEnabled ?? false,
      gatewayUrl:               previous?.gatewayUrl ?? null,
      bannerMessage:            previous?.bannerMessage ?? null,
      maxOvercollectionPercent: previous?.maxOvercollectionPercent ?? 150,
      lastUpdatedBy:            req.session.userId,
      razorpayEnabled: parsed.data.razorpayEnabled,
      razorpayKeyId:   parsed.data.razorpayKeyId || null,
      ...(keySecret     !== undefined ? { razorpayKeySecret:     keySecret }     : {}),
      ...(webhookSecret !== undefined ? { razorpayWebhookSecret: webhookSecret } : {}),
      razorpayMode: parsed.data.razorpayMode,
    });

    const auditParts: string[] = [];
    if (parsed.data.razorpayEnabled !== (previous?.razorpayEnabled ?? false))
      auditParts.push(`Razorpay ${parsed.data.razorpayEnabled ? "enabled" : "disabled"}`);
    if (parsed.data.razorpayKeyId && parsed.data.razorpayKeyId !== previous?.razorpayKeyId)
      auditParts.push("Razorpay Key ID updated");
    if (keySecret     !== undefined) auditParts.push("Razorpay Key Secret updated");
    if (webhookSecret !== undefined) auditParts.push("Razorpay Webhook Secret updated");
    if (parsed.data.razorpayMode !== (previous?.razorpayMode ?? "test"))
      auditParts.push(`Razorpay mode: ${parsed.data.razorpayMode}`);

    if (auditParts.length)
      await appendAudit(req, schoolId, "settings_change", "razorpay_settings", null, auditParts.join("; "));

    res.json({
      ...updated,
      razorpayKeySecret:     updated.razorpayKeySecret     ? "••••••••" : null,
      razorpayWebhookSecret: updated.razorpayWebhookSecret ? "••••••••" : null,
    });
  });

  // ── Save external portal link settings only ───────────────────────────────
  const portalLinkSchema = z.object({
    isEnabled:                z.boolean(),
    gatewayUrl:               z.string().max(500).optional().nullable(),
    bannerMessage:            z.string().max(500).optional().nullable(),
    maxOvercollectionPercent: z.number().int().min(100).max(500).default(150),
  });

  app.put("/api/admin/fees/external-settings/portal", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const parsed = portalLinkSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    const schoolId = req.session.schoolId!;
    const previous = await storage.getExternalPaymentSettings(schoolId);

    const updated = await storage.upsertExternalPaymentSettings(schoolId, {
      // Preserve Razorpay fields from previous settings
      razorpayEnabled:          previous?.razorpayEnabled       ?? false,
      razorpayKeyId:            previous?.razorpayKeyId         ?? null,
      razorpayKeySecret:        previous?.razorpayKeySecret     ?? null,
      razorpayWebhookSecret:    previous?.razorpayWebhookSecret ?? null,
      razorpayMode:             previous?.razorpayMode          ?? "test",
      lastUpdatedBy:            req.session.userId,
      isEnabled:                parsed.data.isEnabled,
      gatewayUrl:               parsed.data.gatewayUrl    || null,
      bannerMessage:            parsed.data.bannerMessage  || null,
      maxOvercollectionPercent: parsed.data.maxOvercollectionPercent,
    });

    const auditParts: string[] = [];
    if (parsed.data.isEnabled !== (previous?.isEnabled ?? false))
      auditParts.push(`External portal ${parsed.data.isEnabled ? "enabled" : "disabled"}`);
    if (parsed.data.gatewayUrl !== (previous?.gatewayUrl ?? null))
      auditParts.push("Gateway URL updated");
    if (parsed.data.maxOvercollectionPercent !== (previous?.maxOvercollectionPercent ?? 150))
      auditParts.push(`Over-collection cap: ${parsed.data.maxOvercollectionPercent}%`);

    if (auditParts.length)
      await appendAudit(req, schoolId, "settings_change", "portal_settings", null, auditParts.join("; "));

    res.json({
      ...updated,
      razorpayKeySecret:     updated.razorpayKeySecret     ? "••••••••" : null,
      razorpayWebhookSecret: updated.razorpayWebhookSecret ? "••••••••" : null,
    });
  });

  // ── Simulated test payment (no Razorpay keys required) ───────────────────
  // Available only when Razorpay is toggled ON but real keys have NOT been saved.
  // Marks the fee Paid immediately with a "TS" receipt prefix.
  app.post("/api/payments/simulate-pay", async (req, res) => {
    const studentId = req.session?.studentId;
    if (!studentId) return res.status(403).json({ message: "Student login required" });

    const { feeRecordId } = req.body;
    if (!feeRecordId || typeof feeRecordId !== "number")
      return res.status(400).json({ message: "feeRecordId required" });

    try {
      // Load fee record + student info
      const feeRows = await db.execute(sql`
        SELECT fr.*, s.school_id AS s_school_id
        FROM fee_records fr
        JOIN students s ON s.id = fr.student_id
        WHERE fr.id = ${feeRecordId} AND fr.student_id = ${studentId}
        LIMIT 1
      `);
      const feeRec = feeRows.rows[0] as any;
      if (!feeRec) return res.status(404).json({ message: "Fee record not found" });

      const schoolId: number = Number(feeRec.s_school_id);

      // Ensure test mode is valid: Razorpay must be enabled but NO real key saved
      const settings = await storage.getExternalPaymentSettings(schoolId);
      if (!settings?.razorpayEnabled)
        return res.status(400).json({ message: "Razorpay is not enabled" });
      if (settings.razorpayKeyId)
        return res.status(400).json({ message: "Use real Razorpay checkout — keys are configured" });

      // Idempotent: already paid
      if (feeRec.status === "Paid")
        return res.json({ ok: true, idempotent: true, receiptNumber: feeRec.receipt_number });

      const now = new Date();
      const receiptNumber = await storage.nextReceiptNumber(schoolId, "TS");

      // Mark Paid
      await db.execute(sql`
        UPDATE fee_records
        SET status = 'Paid', paid_date = ${now.toISOString()}, receipt_number = ${receiptNumber}
        WHERE id = ${feeRecordId} AND school_id = ${schoolId}
      `);

      // Payment record
      const activeSession = await storage.getActiveSession(schoolId);
      await db.insert(paymentRecords).values({
        schoolId,
        sessionId: activeSession?.id ?? null,
        feeRecordId,
        studentId,
        paymentMethod: "Online",
        referenceNumber: `TEST-${Date.now()}`,
        receivedDate: now.toISOString().slice(0, 10),
        amount: Number(feeRec.amount),
        cashierNotes: "Simulated test payment — no real transaction",
        recordedBy: null,
        receiptNumber,
        idempotencyKey: `sim_${feeRecordId}_${now.getTime()}`,
      } as any);

      // Audit log
      await db.execute(sql`
        INSERT INTO fee_audit_log (school_id, action, entity_type, entity_id, changed_by, note, created_at)
        VALUES (${schoolId}, 'payment', 'fee_record', ${feeRecordId}, ${studentId},
          ${"[TEST] Simulated payment — receipt " + receiptNumber}, ${now.toISOString()})
      `);

      console.log(`[simulate-pay] Fee #${feeRecordId} marked Paid with receipt ${receiptNumber}`);
      res.json({ ok: true, receiptNumber });
    } catch (err: any) {
      console.error("[simulate-pay]", err);
      res.status(500).json({ message: String(err) });
    }
  });

  // ── Razorpay: Create Order ────────────────────────────────────────────────
  app.post("/api/payments/create-order", async (req, res) => {
    // Both students and admins can create orders
    const studentId = req.session?.studentId;
    const adminSchoolId = req.session?.schoolId;
    if (!studentId && !adminSchoolId) return res.status(403).json({ message: "Authentication required" });

    const { feeRecordId } = req.body;
    if (!feeRecordId || typeof feeRecordId !== "number") return res.status(400).json({ message: "feeRecordId required" });

    try {
      // Look up fee record
      const feeResult = await db.execute(sql`
        SELECT fr.*, s.school_id FROM fee_records fr
        JOIN students s ON s.id = fr.student_id
        WHERE fr.id = ${feeRecordId}
        LIMIT 1
      `);
      const fee = feeResult.rows[0] as any;
      if (!fee) return res.status(404).json({ message: "Fee record not found" });

      // Scope check: student can only pay their own fees
      if (studentId && Number(fee.student_id) !== studentId)
        return res.status(403).json({ message: "Access denied" });

      const schoolId: number = studentId
        ? (await storage.getStudentById(studentId))!.schoolId
        : adminSchoolId!;

      const settings = await storage.getExternalPaymentSettings(schoolId);
      if (!settings?.razorpayEnabled || !settings.razorpayKeyId || !settings.razorpayKeySecret)
        return res.status(400).json({ message: "Razorpay is not configured for this school" });

      if (!["Due", "Overdue", "Partial"].includes(fee.status))
        return res.status(400).json({ message: "Fee is not payable (status: " + fee.status + ")" });

      const razorpay = new Razorpay({
        key_id: settings.razorpayKeyId,
        key_secret: settings.razorpayKeySecret,
      });

      const amountPaise = Math.round(Number(fee.amount) * 100);
      const order = await razorpay.orders.create({
        amount: amountPaise,
        currency: "INR",
        receipt: `fee_${feeRecordId}`,
        notes: { feeRecordId: String(feeRecordId), schoolId: String(schoolId) },
      });

      res.json({ orderId: order.id, amount: amountPaise, currency: "INR", keyId: settings.razorpayKeyId });
    } catch (err: any) {
      console.error("[razorpay create-order]", err);
      res.status(500).json({ message: err?.error?.description ?? String(err) });
    }
  });

  // ── Razorpay: Webhook ─────────────────────────────────────────────────────
  // Raw body is captured by the global express.json() verify function into req.rawBody
  app.post("/api/webhooks/razorpay", async (req: any, res) => {
    try {
      const sig = req.headers["x-razorpay-signature"] as string | undefined;
      const rawBody: Buffer | undefined = req.rawBody;

      if (!sig || !rawBody) return res.status(400).json({ message: "Missing signature or body" });

      // We don't know which school this belongs to yet — find it from the notes in the body
      const bodyStr = rawBody.toString("utf-8");
      let event: any;
      try { event = JSON.parse(bodyStr); } catch { return res.status(400).json({ message: "Invalid JSON" }); }

      const notes = event?.payload?.payment?.entity?.notes ?? {};
      const schoolId = notes.schoolId ? parseInt(notes.schoolId) : null;
      if (!schoolId) return res.status(400).json({ message: "schoolId missing from payment notes" });

      const settings = await storage.getExternalPaymentSettings(schoolId);
      if (!settings?.razorpayWebhookSecret)
        return res.status(400).json({ message: "Webhook secret not configured" });

      // Verify HMAC
      const expected = crypto.createHmac("sha256", settings.razorpayWebhookSecret).update(bodyStr).digest("hex");
      if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex")))
        return res.status(400).json({ message: "Signature mismatch" });

      if (event.event === "payment.captured") {
        const payment = event.payload.payment.entity;
        const feeRecordId = notes.feeRecordId ? parseInt(notes.feeRecordId) : null;
        if (!feeRecordId) return res.status(400).json({ message: "feeRecordId missing from notes" });

        // Load the fee record
        const feeRec = (await db.execute(sql`SELECT * FROM fee_records WHERE id = ${feeRecordId} AND school_id = ${schoolId} LIMIT 1`)).rows[0] as any;
        if (!feeRec) return res.status(404).json({ message: "Fee record not found" });

        // Already paid? idempotent — 200 OK
        if (feeRec.status === "Paid") return res.json({ ok: true, idempotent: true });

        // Atomically assign next ON receipt
        const receiptNumber = await storage.nextReceiptNumber(schoolId, "ON");

        // Update fee record to Paid
        const now = new Date();
        await db.execute(sql`
          UPDATE fee_records
          SET status = 'Paid', paid_date = ${now.toISOString()}, receipt_number = ${receiptNumber}
          WHERE id = ${feeRecordId} AND school_id = ${schoolId}
        `);

        // Insert payment record
        const activeSession = await storage.getActiveSession(schoolId);
        await db.insert(paymentRecords).values({
          schoolId,
          sessionId: activeSession?.id ?? null,
          feeRecordId,
          studentId: Number(feeRec.student_id),
          paymentMethod: "Online",
          referenceNumber: payment.id,        // pay_XXXX
          receivedDate: now.toISOString().slice(0, 10),
          amount: Number(feeRec.amount),
          cashierNotes: `Razorpay payment ID: ${payment.id}`,
          recordedBy: null,
          receiptNumber,
          idempotencyKey: `rzp_${payment.id}`,
        } as any);

        // Audit log
        await db.execute(sql`
          INSERT INTO fee_audit_log (school_id, action, entity_type, entity_id, changed_by, note, created_at)
          VALUES (${schoolId}, 'payment', 'fee_record', ${feeRecordId}, NULL,
            ${"Online payment via Razorpay — " + payment.id + " — receipt " + receiptNumber}, ${now.toISOString()})
        `);

        console.log(`[razorpay webhook] Paid fee #${feeRecordId} receipt ${receiptNumber}`);
      }

      res.json({ ok: true });
    } catch (err: any) {
      console.error("[razorpay webhook]", err);
      res.status(500).json({ message: String(err) });
    }
  });

  // ── Manual Auto-Invoice Trigger ───────────────────────────────────────────
  // Allows an admin to run the auto-invoice job for a single structure right now,
  // without waiting for the 1st-of-month cron. Only works when autoGenerate=true.
  app.post("/api/admin/fees/structures/:id/auto-invoice/trigger", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const structureId = parseInt(req.params.id);
    if (isNaN(structureId)) return res.status(400).json({ message: "Invalid structure ID" });
    const schoolId = req.session.schoolId!;

    const structure = await storage.getFeeStructureById(structureId, schoolId);
    if (!structure) return res.status(404).json({ message: "Fee structure not found" });

    // Strict guard — must have auto_generate=true AND isActive=true
    if (!Boolean((structure as any).autoGenerate)) {
      return res.status(400).json({
        message: "Auto-generate is OFF for this structure. Turn it ON first before triggering.",
      });
    }
    if (!Boolean((structure as any).isActive)) {
      return res.status(400).json({
        message: "This fee structure is inactive. Activate it before triggering auto-invoices.",
      });
    }

    const activeSession = await storage.getActiveSession(schoolId);
    if (!activeSession) {
      return res.status(400).json({ message: "No active academic session found for this school." });
    }

    const enrollments = await storage.getEnrollmentsBySession(schoolId, activeSession.id);
    const applicableClasses: string[] = (structure as any).applicableClasses ?? [];
    const eligible = applicableClasses.length > 0
      ? enrollments.filter((e: any) => applicableClasses.includes(e.className))
      : enrollments;

    const dueDay: number = (structure as any).autoGenDueDay ?? (structure as any).dueDayOfMonth ?? 10;
    const now = new Date();
    const dueDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(Math.min(dueDay, 28)).padStart(2, "0")}`;

    const existingRecords = await storage.getFeeRecordsBySchool(schoolId, { sessionId: activeSession.id });
    const existingSet = new Set(existingRecords.map((r: any) => `${r.studentId}:${r.feeType}:${String(r.dueDate).slice(0, 7)}`));

    let created = 0, skipped = 0;
    for (const enrollment of eligible) {
      const key = `${enrollment.studentId}:${structure.feeType}:${dueDate.slice(0, 7)}`;
      if (existingSet.has(key)) { skipped++; continue; }
      await storage.createFeeRecord({
        schoolId,
        studentId: enrollment.studentId,
        sessionId: activeSession.id,
        feeType: structure.feeType,
        amount: structure.amount,
        dueDate,
        status: "Due",
        notes: `Auto-generated (manual trigger) on ${now.toLocaleDateString("en-IN")} from fee structure: ${structure.name}`,
      });
      created++;
    }

    // Stamp last-generated timestamp on the structure
    await db.update(feeStructures)
      .set({ lastInvoicesGeneratedAt: new Date() })
      .where(eq(feeStructures.id, structureId));

    await appendAudit(req, schoolId, "auto_invoice", "fee_structure", structureId,
      `Manual auto-invoice trigger for "${structure.name}" (${structure.feeType}): ${created} created, ${skipped} skipped — due ${dueDate}`);

    res.json({ created, skipped, dueDate, session: activeSession.sessionName });
  });

  // ── Audit Log ─────────────────────────────────────────────────────────────

  app.get("/api/admin/fees/audit-log", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const limit = Math.min(parseInt((req.query.limit as string) || "50", 10), 100);
    const offset = parseInt((req.query.offset as string) || "0", 10);
    const { entries, total } = await storage.getFeeAuditLog(req.session.schoolId!, limit, offset);
    res.json({ entries, total, limit, offset });
  });

  // ── Sessions list (convenience for fee invoice generation dropdown) ───────
  app.get("/api/admin/fees/sessions", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const sessions = await storage.getAcademicSessions(req.session.schoolId!);
    res.json(sessions);
  });

  // ── Bulk Invoice Generation ────────────────────────────────────────────────
  app.post("/api/admin/fees/structures/:id/generate-invoices", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const structureId = parseInt(req.params.id);
    if (isNaN(structureId)) return res.status(400).json({ message: "Invalid structure ID" });
    const schoolId = req.session.schoolId!;

    const parsed = z.object({
      sessionId: z.number().int().positive(),
      targetClasses: z.array(z.string()).default([]),
      dueDate: z.string().min(1, "Due date required"),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });

    const { sessionId, dueDate } = parsed.data;
    const structure = await storage.getFeeStructureById(structureId, schoolId);
    if (!structure) return res.status(404).json({ message: "Fee structure not found" });

    const enrollments = await storage.getEnrollmentsBySession(schoolId, sessionId);
    // Always enforce the structure's own applicableClasses — the frontend cannot override this.
    // If no classes are set on the structure, the fee applies to every enrolled student.
    const applicableClasses: string[] = (structure as any).applicableClasses ?? [];
    const filtered = applicableClasses.length > 0
      ? enrollments.filter(e => applicableClasses.includes(e.className))
      : enrollments;

    const existingRecords = await storage.getFeeRecordsBySchool(schoolId, { sessionId });
    const existingSet = new Set(existingRecords.map(r => `${r.studentId}:${r.feeType}`));

    let created = 0, skipped = 0;
    for (const enrollment of filtered) {
      const key = `${enrollment.studentId}:${structure.feeType}`;
      if (existingSet.has(key)) { skipped++; continue; }
      await storage.createFeeRecord({
        schoolId, studentId: enrollment.studentId, sessionId,
        feeType: structure.feeType, amount: structure.amount, dueDate, status: "Due",
        notes: `Auto-generated from fee structure: ${structure.name}`,
      });
      created++;
    }

    // Stamp last-generated timestamp on the structure
    await db.update(feeStructures)
      .set({ lastInvoicesGeneratedAt: new Date() })
      .where(eq(feeStructures.id, structureId));

    await appendAudit(req, schoolId, "create", "fee_record", null,
      `Bulk generated ${created} invoices from "${structure.name}" (${skipped} skipped as duplicates)`);
    res.json({ created, skipped, total: filtered.length });
  });

  // ── Receipt Number Preview (no-commit peek) ───────────────────────────────
  // Returns the NEXT receipt number without incrementing the sequence counter.
  // Used by the Add Fee and Record Offline Payment modals to show a preview.
  app.get("/api/admin/fees/next-receipt", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const prefix = String(req.query.prefix ?? "").toUpperCase();
    if (!["AF", "OP"].includes(prefix)) {
      return res.status(400).json({ message: "prefix must be AF or OP" });
    }
    const preview = await storage.peekReceiptNumber(schoolId, prefix);
    res.json({ preview });
  });

  // ── Admin Payment Receipt HTML ─────────────────────────────────────────────
  app.get("/api/admin/fees/payments/:id/receipt", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const payments = await storage.getPaymentRecordsBySchool(schoolId);
    const payment = payments.find(p => p.id === id);
    if (!payment) return res.status(404).json({ message: "Payment record not found" });

    const student = await storage.getStudentById(payment.studentId);
    if (!student) return res.status(404).json({ message: "Student not found" });

    let feeType: string | null = null;
    if (payment.feeRecordId) {
      const recs = await storage.getFeeRecordsByStudent(payment.studentId, schoolId);
      feeType = recs.find(r => r.id === payment.feeRecordId)?.feeType ?? null;
    }

    const [school] = await db.select({ name: schools.name }).from(schools).where(eq(schools.id, schoolId));
    const esc = (s: string | null | undefined) =>
      (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

    const receivedDateStr = payment.receivedDate
      ? new Date(payment.receivedDate).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })
      : "—";
    const amountStr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(payment.amount);
    const schoolName = esc(school?.name ?? "School");
    const methodLabel: Record<string, string> = {
      Cash: "Cash", Cheque: "Cheque", BankTransfer: "Bank Transfer",
      DemandDraft: "Demand Draft", Online: "Online Transfer",
    };

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Payment Receipt</title>
<style>
  body{font-family:Arial,sans-serif;margin:0;padding:32px;color:#1e293b;background:#fff;}
  .receipt{max-width:580px;margin:auto;border:2px solid #06b6d4;border-radius:12px;padding:32px;}
  .header{text-align:center;border-bottom:2px solid #e2e8f0;padding-bottom:20px;margin-bottom:20px;}
  .header h1{margin:0 0 4px;font-size:22px;color:#0891b2;}
  .header p{margin:0;font-size:13px;color:#64748b;}
  .badge{display:inline-block;background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;border-radius:20px;padding:4px 14px;font-weight:700;font-size:13px;margin-bottom:16px;}
  table{width:100%;border-collapse:collapse;margin-top:8px;}
  td{padding:9px 6px;font-size:14px;border-bottom:1px solid #f1f5f9;}
  td:first-child{color:#64748b;width:45%;}
  td:last-child{font-weight:600;}
  .amount-row td:last-child{font-size:18px;font-weight:800;color:#0891b2;}
  .footer{margin-top:24px;text-align:center;font-size:11px;color:#94a3b8;}
  @media print{body{padding:0;}button{display:none;}}
</style></head><body>
<div class="receipt">
  <div class="header"><h1>${schoolName}</h1><p>Offline Payment Receipt</p></div>
  <div style="text-align:center;margin-bottom:16px;"><span class="badge">&#10003; PAYMENT RECEIVED</span></div>
  <table>
    <tr><td>Receipt No.</td><td>${(payment as any).receiptNumber ?? `PAY-${payment.id}`}</td></tr>
    <tr><td>Student Name</td><td>${esc(student.name)}</td></tr>
    <tr><td>Student ID</td><td>${esc(student.digitalStudentId)}</td></tr>
    <tr><td>Class / Section</td><td>${esc(student.class)} / ${esc(student.section)}</td></tr>
    ${feeType ? `<tr><td>Fee Type</td><td>${esc(feeType)}</td></tr>` : ""}
    <tr><td>Payment Method</td><td>${esc(methodLabel[payment.paymentMethod] ?? payment.paymentMethod)}</td></tr>
    ${payment.referenceNumber ? `<tr><td>Reference No.</td><td>${esc(payment.referenceNumber)}</td></tr>` : ""}
    <tr><td>Received Date</td><td>${receivedDateStr}</td></tr>
    ${payment.cashierNotes ? `<tr><td>Notes</td><td>${esc(payment.cashierNotes)}</td></tr>` : ""}
    <tr class="amount-row"><td>Amount Received</td><td>${amountStr}</td></tr>
  </table>
  <div class="footer">
    <p>This is a computer-generated receipt. No signature required.</p>
    <p>&#169; ${new Date().getFullYear()} BENIUS &middot; ${schoolName}</p>
  </div>
</div>
<script>window.print();</script>
</body></html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="payment-receipt-${payment.id}.html"`);
    res.send(html);
  });

  // ── Fee Record Receipt HTML (Add Fee — AF receipts) ──────────────────────
  // Generates a printable receipt directly from the fee record, so Add Fee
  // entries that have no offline payment record still get a receipt.
  app.get("/api/admin/fees/:id/receipt", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    const recs = await db.execute(sql`
      SELECT fr.*, s.name AS student_name, s.digital_student_id, s.class, s.section
      FROM fee_records fr
      JOIN students s ON s.id = fr.student_id
      WHERE fr.id = ${id} AND fr.school_id = ${schoolId}
      LIMIT 1
    `);
    const row = recs.rows[0] as any;
    if (!row) return res.status(404).json({ message: "Fee record not found" });

    const [school] = await db.select({ name: schools.name }).from(schools).where(eq(schools.id, schoolId));
    const esc = (s: string | null | undefined) =>
      (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

    const paidDateStr = row.paid_date
      ? new Date(row.paid_date).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })
      : "—";
    const dueDateStr = row.due_date
      ? new Date(row.due_date).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })
      : "—";
    const amountStr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(row.amount);
    const schoolName = esc(school?.name ?? "School");
    const receiptNo = esc(row.receipt_number ?? `FEE-${row.id}`);

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Fee Receipt</title>
<style>
  body{font-family:Arial,sans-serif;margin:0;padding:32px;color:#1e293b;background:#fff;}
  .receipt{max-width:580px;margin:auto;border:2px solid #06b6d4;border-radius:12px;padding:32px;}
  .header{text-align:center;border-bottom:2px solid #e2e8f0;padding-bottom:20px;margin-bottom:20px;}
  .header h1{margin:0 0 4px;font-size:22px;color:#0891b2;}
  .header p{margin:0;font-size:13px;color:#64748b;}
  .badge{display:inline-block;background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;border-radius:20px;padding:4px 14px;font-weight:700;font-size:13px;margin-bottom:16px;}
  table{width:100%;border-collapse:collapse;margin-top:8px;}
  td{padding:9px 6px;font-size:14px;border-bottom:1px solid #f1f5f9;}
  td:first-child{color:#64748b;width:45%;}
  td:last-child{font-weight:600;}
  .amount-row td:last-child{font-size:18px;font-weight:800;color:#0891b2;}
  .footer{margin-top:24px;text-align:center;font-size:11px;color:#94a3b8;}
  @media print{body{padding:0;}button{display:none;}}
</style></head><body>
<div class="receipt">
  <div class="header"><h1>${schoolName}</h1><p>Fee Payment Receipt</p></div>
  <div style="text-align:center;margin-bottom:16px;"><span class="badge">&#10003; FEE RECORDED</span></div>
  <table>
    <tr><td>Receipt No.</td><td>${receiptNo}</td></tr>
    <tr><td>Student Name</td><td>${esc(row.student_name)}</td></tr>
    <tr><td>Student ID</td><td>${esc(row.digital_student_id)}</td></tr>
    <tr><td>Class / Section</td><td>${esc(row.class)} / ${esc(row.section)}</td></tr>
    <tr><td>Fee Type</td><td>${esc(row.fee_type)}</td></tr>
    <tr><td>Academic Year</td><td>${esc(row.academic_year ?? "—")}</td></tr>
    <tr><td>Status</td><td>${esc(row.status)}</td></tr>
    ${row.due_date ? `<tr><td>Due Date</td><td>${dueDateStr}</td></tr>` : ""}
    ${row.paid_date ? `<tr><td>Paid On</td><td>${paidDateStr}</td></tr>` : ""}
    ${row.notes ? `<tr><td>Notes</td><td>${esc(row.notes)}</td></tr>` : ""}
    <tr class="amount-row"><td>Amount</td><td>${amountStr}</td></tr>
  </table>
  <div class="footer">
    <p>This is a computer-generated receipt. No signature required.</p>
    <p>&#169; ${new Date().getFullYear()} BENIUS &middot; ${schoolName}</p>
  </div>
</div>
<script>window.print();</script>
</body></html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="fee-receipt-${id}.html"`);
    res.send(html);
  });

  // ── School-wide Ledger Export (CSV) ──────────────────────────────────────
  app.get("/api/admin/fees/export-ledger", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const viewSessionId: number | null = (req as any).viewSessionId ?? null;
    const sessionFilter = viewSessionId ?? (await storage.getActiveSession(schoolId))?.id ?? null;

    // Parse optional query filters
    const { dateFrom, dateTo, class: classFilter, feeType: feeTypeFilter } = req.query as {
      dateFrom?: string; dateTo?: string; class?: string; feeType?: string;
    };

    // Build a joined query: fee_records LEFT JOIN students LEFT JOIN (aggregated payment_records)
    // One row per fee record; amounts in rupees. Always scoped to the viewed session.
    const rows = await db.execute(sql`
      SELECT
        s.name              AS student_name,
        s.digital_student_id AS student_id,
        s.class             AS class,
        s.section           AS section,
        fr.fee_type         AS fee_type,
        fr.amount           AS invoice_amount,
        COALESCE(p.total_paid, 0)::int  AS amount_paid,
        GREATEST(fr.amount - COALESCE(p.total_paid, 0), 0)::int AS outstanding,
        fr.status           AS status,
        fr.due_date         AS due_date,
        fr.paid_date        AS paid_date,
        fr.academic_year    AS academic_year,
        p.last_method       AS payment_method,
        p.last_reference    AS reference_number,
        fr.receipt_number   AS receipt_number,
        fr.notes            AS notes,
        fr.id               AS fee_record_id
      FROM fee_records fr
      LEFT JOIN students s ON s.id = fr.student_id
      LEFT JOIN (
        SELECT
          fee_record_id,
          SUM(amount)::int                               AS total_paid,
          (array_agg(payment_method ORDER BY created_at DESC))[1] AS last_method,
          (array_agg(reference_number ORDER BY created_at DESC))[1] AS last_reference
        FROM payment_records
        WHERE school_id = ${schoolId}
          AND fee_record_id IS NOT NULL
        GROUP BY fee_record_id
      ) p ON p.fee_record_id = fr.id
      WHERE fr.school_id = ${schoolId}
        ${sessionFilter != null ? sql`AND fr.session_id = ${sessionFilter}` : sql``}
        ${dateFrom ? sql`AND fr.due_date >= ${dateFrom}` : sql``}
        ${dateTo   ? sql`AND fr.due_date <= ${dateTo}`   : sql``}
        ${classFilter  ? sql`AND s.class = ${classFilter}`   : sql``}
        ${feeTypeFilter ? sql`AND fr.fee_type = ${feeTypeFilter}` : sql``}
      ORDER BY s.class, s.name, fr.due_date
    `);

    const esc = (v: string | null | undefined) => {
      const s = v == null ? "" : String(v);
      // Wrap in quotes; double internal quotes
      return `"${s.replace(/"/g, '""')}"`;
    };

    const fmtDateLocal = (d: string | null | undefined) => {
      if (!d) return "";
      try { return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }
      catch { return String(d); }
    };

    const headers = [
      "Student Name", "Student ID", "Class", "Section",
      "Fee Type", "Invoice Amount (₹)", "Amount Paid (₹)", "Outstanding (₹)",
      "Status", "Due Date", "Paid Date", "Academic Year",
      "Payment Method", "Reference No.", "Receipt No.", "Notes",
    ];

    const dataRows = (rows.rows as any[]).map(r => [
      esc(r.student_name),
      esc(r.student_id),
      esc(r.class),
      esc(r.section),
      esc(r.fee_type),
      esc(r.invoice_amount),
      esc(r.amount_paid),
      esc(r.outstanding),
      esc(r.status),
      esc(fmtDateLocal(r.due_date)),
      esc(fmtDateLocal(r.paid_date)),
      esc(r.academic_year),
      esc(r.payment_method),
      esc(r.last_reference ?? r.reference_number),
      esc(r.receipt_number),
      esc(r.notes),
    ].join(","));

    const csv = [headers.map(h => `"${h}"`).join(","), ...dataRows].join("\r\n");
    const dateTag = new Date().toISOString().split("T")[0];

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="payment-ledger-${dateTag}.csv"`);
    // BOM for Excel UTF-8 detection
    res.send("\uFEFF" + csv);
  });

  // ── Receipt Backfill (one-time, idempotent) ───────────────────────────────
  // Assigns AF receipt numbers to fee_records with receipt_number IS NULL and
  // OP receipt numbers to payment_records with receipt_number IS NULL.
  // Safe to call multiple times — re-running skips already-numbered rows.
  //
  // Concurrency guard: pg_try_advisory_xact_lock runs inside db.transaction()
  // so acquire + all work + auto-release are pinned to the same DB connection.
  // Transaction-scoped locks release automatically when the transaction ends
  // (commit or rollback), so there is no risk of a stuck lock from pool churn.
  // A concurrent call sees the lock held and receives 409 immediately.
  const BACKFILL_LOCK_NS = 987654321; // arbitrary namespace for this operation
  app.post("/api/admin/fees/backfill-receipts", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;

    let afCount = 0;
    let opCount = 0;
    let lockBlocked = false;
    let afFirst: string | null = null;
    let afLast: string | null = null;
    let opFirst: string | null = null;
    let opLast: string | null = null;

    await db.transaction(async (tx) => {
      // pg_try_advisory_xact_lock is transaction-scoped: it is guaranteed to
      // run on the same connection as the rest of the transaction and releases
      // automatically at commit/rollback — safe with connection pools.
      const lockResult = await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(${BACKFILL_LOCK_NS}, ${schoolId}) AS acquired`,
      );
      const lockAcquired = (lockResult.rows[0] as { acquired: boolean }).acquired;
      if (!lockAcquired) {
        lockBlocked = true;
        return; // exit transaction callback; no writes; lock not held by us
      }

      // ── 1. Backfill fee_records (AF prefix) ───────────────────────────────
      const nullFeeRows = await tx.execute(
        sql`SELECT id FROM fee_records
            WHERE school_id = ${schoolId}
              AND receipt_number IS NULL
            ORDER BY id ASC`,
      );
      const feeIds = (nullFeeRows.rows as { id: number }[]).map(r => r.id);

      if (feeIds.length > 0) {
        // Claim the entire AF range in one atomic step — inside the transaction —
        // so the sequence advance rolls back with the row updates if the server
        // crashes mid-run.  This prevents gaps from partial backfill runs.
        const afSeqResult = await tx.execute(
          sql`INSERT INTO receipt_sequences (prefix, current_number)
                VALUES ('AF', ${feeIds.length})
              ON CONFLICT (prefix) DO UPDATE
                SET current_number = receipt_sequences.current_number + ${feeIds.length}
              RETURNING current_number`,
        );
        const afEnd = Number((afSeqResult.rows[0] as any).current_number);
        const afStart = afEnd - feeIds.length + 1;

        for (let i = 0; i < feeIds.length; i++) {
          const n = afStart + i;
          const receiptNumber = `AF${String(n).padStart(2, "0")}`;
          await tx.execute(
            sql`UPDATE fee_records
                SET receipt_number = ${receiptNumber}
                WHERE id = ${feeIds[i]} AND school_id = ${schoolId}`,
          );
          if (i === 0) afFirst = receiptNumber;
          afLast = receiptNumber;
          afCount++;
        }
      }

      // ── 2. Backfill payment_records (OP prefix) ───────────────────────────
      const nullPayRows = await tx.execute(
        sql`SELECT id FROM payment_records
            WHERE school_id = ${schoolId}
              AND receipt_number IS NULL
            ORDER BY id ASC`,
      );
      const payIds = (nullPayRows.rows as { id: number }[]).map(r => r.id);

      if (payIds.length > 0) {
        // Same atomic batch pattern: advance the OP sequence once inside the
        // transaction so a mid-run crash rolls back both the counter and the rows.
        const opSeqResult = await tx.execute(
          sql`INSERT INTO receipt_sequences (prefix, current_number)
                VALUES ('OP', ${payIds.length})
              ON CONFLICT (prefix) DO UPDATE
                SET current_number = receipt_sequences.current_number + ${payIds.length}
              RETURNING current_number`,
        );
        const opEnd = Number((opSeqResult.rows[0] as any).current_number);
        const opStart = opEnd - payIds.length + 1;

        for (let i = 0; i < payIds.length; i++) {
          const n = opStart + i;
          const receiptNumber = `OP${String(n).padStart(2, "0")}`;
          await tx.execute(
            sql`UPDATE payment_records
                SET receipt_number = ${receiptNumber}
                WHERE id = ${payIds[i]} AND school_id = ${schoolId}`,
          );
          if (i === 0) opFirst = receiptNumber;
          opLast = receiptNumber;
          opCount++;
        }
      }
      // Transaction commits here → xact lock auto-released by PostgreSQL.
      // Because the sequence advances were also inside this transaction, a crash
      // before commit rolls back both the counter and the row updates — no gaps.
    });

    if (lockBlocked) {
      return res.status(409).json({
        message: "Receipt backfill is already running. Please wait for it to finish and try again.",
        alreadyRunning: true,
      });
    }

    // Build human-readable range strings (e.g. "AF01–AF05" or null when nothing assigned)
    const afRange = afFirst && afLast
      ? (afFirst === afLast ? afFirst : `${afFirst}–${afLast}`)
      : null;
    const opRange = opFirst && opLast
      ? (opFirst === opLast ? opFirst : `${opFirst}–${opLast}`)
      : null;

    await appendAudit(
      req, schoolId, "backfill_receipts", "fee_record", null,
      `Receipt backfill complete: ${afCount} fee record(s) assigned AF numbers${afRange ? ` (${afRange})` : ""}, ${opCount} payment record(s) assigned OP numbers${opRange ? ` (${opRange})` : ""}`,
    );

    res.json({
      success: true,
      feeRecordsUpdated: afCount,
      paymentRecordsUpdated: opCount,
      afRange,
      opRange,
      message: `Backfill complete: ${afCount} fee record(s) and ${opCount} payment record(s) assigned receipt numbers.`,
    });
  });

  // ── Admin: Notification Config GET ────────────────────────────────────────
  app.get("/api/admin/fees/notification-config", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const cfg = await storage.getNotificationConfig(schoolId);
    // Mask API keys — return a sentinel so frontend knows key is set
    const mask = (v: string | null | undefined) => v ? "••••••••" : null;
    res.json(cfg ? {
      smsEnabled: cfg.smsEnabled,
      msg91AuthKey: mask(cfg.msg91AuthKey),
      msg91SenderId: cfg.msg91SenderId,
      waEnabled: cfg.waEnabled,
      msg91WaNumber: cfg.msg91WaNumber,
      msg91WaTemplate: cfg.msg91WaTemplate,
      emailEnabled: cfg.emailEnabled,
      emailProvider: cfg.emailProvider ?? "sendgrid",
      sendgridApiKey: mask(cfg.sendgridApiKey),
      sendgridFromEmail: cfg.sendgridFromEmail,
      sendgridFromName: cfg.sendgridFromName,
      mailtrapApiKey: mask(cfg.mailtrapApiKey),
      mailtrapInboxId: cfg.mailtrapInboxId,
    } : null);
  });

  // ── Admin: Notification Config PUT ────────────────────────────────────────
  const notifSchema = z.object({
    smsEnabled:        z.boolean().default(false),
    msg91AuthKey:      z.string().optional().nullable(),
    msg91SenderId:     z.string().optional().nullable(),
    waEnabled:         z.boolean().default(false),
    msg91WaNumber:     z.string().optional().nullable(),
    msg91WaTemplate:   z.string().optional().nullable(),
    emailEnabled:      z.boolean().default(false),
    emailProvider:     z.enum(["sendgrid", "mailtrap"]).default("sendgrid"),
    sendgridApiKey:    z.string().optional().nullable(),
    sendgridFromEmail: z.string().email().optional().nullable(),
    sendgridFromName:  z.string().optional().nullable(),
    mailtrapApiKey:    z.string().optional().nullable(),
    mailtrapInboxId:   z.string().optional().nullable(),
  });

  app.put("/api/admin/fees/notification-config", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const parsed = notifSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });

    const d = parsed.data;
    // Only update a key field if the client sent a real value (not the masked sentinel)
    const existing = await storage.getNotificationConfig(schoolId);
    const resolveKey = (incoming: string | null | undefined, stored: string | null | undefined) => {
      if (!incoming || incoming === "••••••••") return stored ?? null;
      return incoming;
    };

    const update = {
      smsEnabled:        d.smsEnabled,
      msg91AuthKey:      resolveKey(d.msg91AuthKey, existing?.msg91AuthKey),
      msg91SenderId:     d.msg91SenderId ?? existing?.msg91SenderId ?? null,
      waEnabled:         d.waEnabled,
      msg91WaNumber:     d.msg91WaNumber ?? existing?.msg91WaNumber ?? null,
      msg91WaTemplate:   d.msg91WaTemplate ?? existing?.msg91WaTemplate ?? null,
      emailEnabled:      d.emailEnabled,
      emailProvider:     d.emailProvider ?? existing?.emailProvider ?? "sendgrid",
      sendgridApiKey:    resolveKey(d.sendgridApiKey, existing?.sendgridApiKey),
      sendgridFromEmail: d.sendgridFromEmail ?? existing?.sendgridFromEmail ?? null,
      sendgridFromName:  d.sendgridFromName ?? existing?.sendgridFromName ?? null,
      mailtrapApiKey:    resolveKey(d.mailtrapApiKey, existing?.mailtrapApiKey),
      mailtrapInboxId:   d.mailtrapInboxId ?? existing?.mailtrapInboxId ?? null,
    };

    await storage.upsertNotificationConfig(schoolId, update);
    await appendAudit(req, schoolId, "update_notification_config", "notification_config", null, `Notification config updated`);
    res.json({ ok: true });
  });

  // ── Admin: Dunning Log GET (school-wide or per-student) ─────────────────
  // ?studentId=X → all dunning attempts for that student (up to 200)
  app.get("/api/admin/fees/dunning-log", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const studentId = req.query.studentId ? parseInt(req.query.studentId as string) : null;
    if (studentId !== null && isNaN(studentId)) {
      return res.status(400).json({ message: "Invalid studentId" });
    }
    const result = await db.execute(
      studentId !== null
        ? sql`
            SELECT dl.id, dl.fee_record_id, dl.channel, dl.stage, dl.sent_at, dl.status,
                   dl.error_message, dl.recipient, dl.student_name
            FROM dunning_log dl
            INNER JOIN fee_records fr ON fr.id = dl.fee_record_id
            WHERE dl.school_id = ${schoolId}
              AND fr.student_id = ${studentId}
            ORDER BY dl.sent_at DESC
            LIMIT 200`
        : sql`
            SELECT id, fee_record_id, channel, stage, sent_at, status,
                   error_message, recipient, student_name
            FROM dunning_log
            WHERE school_id = ${schoolId}
            ORDER BY sent_at DESC
            LIMIT 50`,
    );
    res.json(result.rows);
  });

  // ── Admin: Dunning Templates GET ─────────────────────────────────────────
  app.get("/api/admin/fees/dunning-templates", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const rows = await db.select().from(dunningTemplates).where(eq(dunningTemplates.schoolId, schoolId));
    res.json(rows);
  });

  // ── Admin: Dunning Templates PUT (upsert all) ────────────────────────────
  const dunningTemplateEntrySchema = z.object({
    stage:       z.enum(["D0", "D7", "D14", "D30"]),
    channel:     z.enum(["sms", "email"]),
    bodyText:    z.string().min(1, "Template body cannot be empty"),
    subjectText: z.string().optional().nullable(),
  });
  const dunningTemplatesSchema = z.object({
    templates: z.array(dunningTemplateEntrySchema),
  });

  app.put("/api/admin/fees/dunning-templates", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const parsed = dunningTemplatesSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });

    const { templates } = parsed.data;
    for (const t of templates) {
      await db
        .insert(dunningTemplates)
        .values({
          schoolId,
          stage: t.stage,
          channel: t.channel,
          bodyText: t.bodyText,
          subjectText: t.subjectText ?? null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [dunningTemplates.schoolId, dunningTemplates.stage, dunningTemplates.channel],
          set: {
            bodyText: t.bodyText,
            subjectText: t.subjectText ?? null,
            updatedAt: new Date(),
          },
        });
    }
    res.json({ ok: true });
  });

  // ── Admin: Dunning Simulation ─────────────────────────────────────────────
  app.post("/api/admin/fees/dunning-simulate", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    try {
      const viewSessionId: number | null = (req as any).viewSessionId ?? null;
      const sessionFilter = viewSessionId ?? (await storage.getActiveSession(schoolId))?.id ?? null;
      const { runDunningSimulation } = await import("./dunning");
      const result = await runDunningSimulation(schoolId, sessionFilter);
      res.json(result);
    } catch (err) {
      res.status(500).json({ message: String(err) });
    }
  });

  // ── Admin: Test Notification ───────────────────────────────────────────────
  app.post("/api/admin/fees/notification-config/test", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const { channel, recipient } = req.body as { channel: string; recipient: string };
    if (!channel || !recipient) return res.status(400).json({ message: "channel and recipient required" });

    const testText = "This is a test notification from your school fee management system.";

    try {
      // ── Webhook Capture (no saved config needed) ─────────────────────────
      if (channel === "webhook") {
        if (!recipient.startsWith("http")) return res.status(400).json({ message: "recipient must be a valid URL" });
        const payload = {
          _source: "benius_fee_dunning_test",
          channel: "webhook",
          timestamp: new Date().toISOString(),
          sample_notification: {
            studentName: "Test Student",
            guardianName: "Test Parent",
            feeName: "Tuition Fee",
            amount: 5000,
            dueDate: new Date().toISOString().split("T")[0],
            stage: "D7",
            message: testText,
          },
        };
        const r = await fetch(recipient, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!r.ok) {
          const body = await r.text();
          return res.status(400).json({ message: `Webhook error ${r.status}: ${body.substring(0, 200)}` });
        }
        return res.json({ ok: true, message: `Payload posted to ${recipient}` });
      }

      const cfg = await storage.getNotificationConfig(schoolId);
      if (!cfg) return res.status(400).json({ message: "No notification config saved yet" });

      if (channel === "sms") {
        if (!cfg.msg91AuthKey || !cfg.msg91SenderId) return res.status(400).json({ message: "SMS not configured" });
        const mobile = recipient.replace(/\D/g, "").replace(/^0/, "91").replace(/^(?!91)/, "91");
        const r = await fetch("https://api.msg91.com/api/v2/sendsms", {
          method: "POST",
          headers: { authkey: cfg.msg91AuthKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            sender: cfg.msg91SenderId.substring(0, 6).toUpperCase(),
            route: "4", country: "91",
            sms: [{ message: testText, to: [mobile] }],
          }),
        });
        const body = await r.text();
        if (!r.ok) return res.status(400).json({ message: `MSG91 error: ${body.substring(0, 200)}` });

      } else if (channel === "email") {
        const provider = cfg.emailProvider ?? "sendgrid";
        if (provider === "mailtrap") {
          if (!cfg.mailtrapApiKey) return res.status(400).json({ message: "Mailtrap not configured" });
          const inboxId = cfg.mailtrapInboxId || "default";
          const r = await fetch(`https://sandbox.api.mailtrap.io/api/send/${inboxId}`, {
            method: "POST",
            headers: { Authorization: `Bearer ${cfg.mailtrapApiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: { email: "fees@school.local", name: "School Admin" },
              to: [{ email: recipient }],
              subject: "Test Notification — Mailtrap",
              text: testText,
            }),
          });
          if (!r.ok) {
            const body = await r.text();
            return res.status(400).json({ message: `Mailtrap error: ${body.substring(0, 200)}` });
          }
        } else {
          if (!cfg.sendgridApiKey || !cfg.sendgridFromEmail) return res.status(400).json({ message: "SendGrid not configured" });
          const r = await fetch("https://api.sendgrid.com/v3/mail/send", {
            method: "POST",
            headers: { Authorization: `Bearer ${cfg.sendgridApiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              personalizations: [{ to: [{ email: recipient }] }],
              from: { email: cfg.sendgridFromEmail, name: cfg.sendgridFromName || "School Admin" },
              subject: "Test Notification",
              content: [{ type: "text/plain", value: testText }],
            }),
          });
          if (!r.ok) {
            const body = await r.text();
            return res.status(400).json({ message: `SendGrid error: ${body.substring(0, 200)}` });
          }
        }
      } else {
        return res.status(400).json({ message: "channel must be sms, email, or webhook" });
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ message: String(err) });
    }
  });

  // ── Student: Notification History ─────────────────────────────────────────
  app.get("/api/student/fees/notification-history", async (req, res) => {
    if (!req.session?.studentId) return res.status(403).json({ message: "Student access required" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(403).json({ message: "Student not found" });
    const rows = await storage.getDunningLogByStudent(student.id, student.schoolId);
    // Strip any admin-only fields — only expose channel, stage, sentAt, status, recipient
    const safe = rows.map(r => ({
      id: r.id,
      feeRecordId: r.feeRecordId,
      channel: r.channel,
      stage: r.stage,
      sentAt: r.sentAt,
      status: r.status,
      recipient: r.recipient,
    }));
    res.json(safe);
  });

  // ── Student: External Portal Info ─────────────────────────────────────────
  app.get("/api/student/fees/portal-info", async (req, res) => {
    if (!req.session?.studentId) return res.status(403).json({ message: "Student access required" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(403).json({ message: "Student not found" });
    const settings = await storage.getExternalPaymentSettings(student.schoolId);
    res.json({
      isEnabled: settings?.isEnabled ?? false,
      gatewayUrl: settings?.gatewayUrl ?? null,
      bannerMessage: settings?.bannerMessage ?? null,
      razorpayEnabled: settings?.razorpayEnabled ?? false,
      razorpayKeyId: settings?.razorpayEnabled ? (settings?.razorpayKeyId ?? null) : null,
    });
  });
}
