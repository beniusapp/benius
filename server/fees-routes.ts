import type { Express } from "express";
import { storage } from "./storage";
import { db } from "./db";
import { users, schools, students, feeRecords, paymentRecords } from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";

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
    const opts: { studentId?: number; feeRecordId?: number } = {};
    if (studentId) opts.studentId = parseInt(studentId);
    if (feeRecordId) opts.feeRecordId = parseInt(feeRecordId);
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
    // the sequence counter is always consumed (even on rollback), ensuring
    // no two payments ever share a receipt number.
    const opReceipt = await storage.nextReceiptNumber("OP");

    // Auto-create a fee record when none is pre-linked but fee details were supplied
    if (!paymentData.feeRecordId && paymentData.feeType) {
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
      `Recorded ${paymentOnly.paymentMethod} ₹${paymentOnly.amount} for student #${paymentOnly.studentId}`);
    res.status(201).json(rec);
  });

  // ── External Payment Settings ─────────────────────────────────────────────

  const externalSettingsSchema = z.object({
    isEnabled: z.boolean(),
    gatewayUrl: z.string().max(500).optional().nullable(),
    bannerMessage: z.string().max(500).optional().nullable(),
    maxOvercollectionPercent: z.number().int().min(100).max(500).default(150),
  });

  app.get("/api/admin/fees/external-settings", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const settings = await storage.getExternalPaymentSettings(req.session.schoolId!);
    res.json(settings ?? { isEnabled: false, gatewayUrl: null, bannerMessage: null, maxOvercollectionPercent: 150 });
  });

  app.put("/api/admin/fees/external-settings", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const parsed = externalSettingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    const schoolId = req.session.schoolId!;
    const previous = await storage.getExternalPaymentSettings(schoolId);
    const updated = await storage.upsertExternalPaymentSettings(schoolId, {
      ...parsed.data,
      gatewayUrl: parsed.data.gatewayUrl || null,
      bannerMessage: parsed.data.bannerMessage || null,
      lastUpdatedBy: req.session.userId,
    });
    const capChanged = previous?.maxOvercollectionPercent !== parsed.data.maxOvercollectionPercent;
    const auditParts: string[] = [];
    auditParts.push(`External payment portal ${parsed.data.isEnabled ? "enabled" : "disabled"}`);
    if (parsed.data.gatewayUrl) auditParts.push(`URL: ${parsed.data.gatewayUrl}`);
    if (capChanged) {
      auditParts.push(`Max over-collection cap changed: ${previous?.maxOvercollectionPercent ?? 150}% → ${parsed.data.maxOvercollectionPercent}%`);
    }
    await appendAudit(req, schoolId, "settings_change", "external_settings", null, auditParts.join("; "));
    res.json(updated);
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

    const { sessionId, targetClasses, dueDate } = parsed.data;
    const structure = await storage.getFeeStructureById(structureId, schoolId);
    if (!structure) return res.status(404).json({ message: "Fee structure not found" });

    const enrollments = await storage.getEnrollmentsBySession(schoolId, sessionId);
    const filtered = targetClasses.length > 0
      ? enrollments.filter(e => targetClasses.includes(e.className))
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

    await appendAudit(req, schoolId, "create", "fee_record", null,
      `Bulk generated ${created} invoices from "${structure.name}" (${skipped} skipped as duplicates)`);
    res.json({ created, skipped, total: filtered.length });
  });

  // ── Receipt Number Preview (no-commit peek) ───────────────────────────────
  // Returns the NEXT receipt number without incrementing the sequence counter.
  // Used by the Add Fee and Record Offline Payment modals to show a preview.
  app.get("/api/admin/fees/next-receipt", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const prefix = String(req.query.prefix ?? "").toUpperCase();
    if (!["AF", "OP"].includes(prefix)) {
      return res.status(400).json({ message: "prefix must be AF or OP" });
    }
    const preview = await storage.peekReceiptNumber(prefix);
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

  // ── School-wide Ledger Export (CSV) ──────────────────────────────────────
  app.get("/api/admin/fees/export-ledger", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;

    // Parse optional query filters
    const { dateFrom, dateTo, class: classFilter, feeType: feeTypeFilter } = req.query as {
      dateFrom?: string; dateTo?: string; class?: string; feeType?: string;
    };

    // Build a joined query: fee_records LEFT JOIN students LEFT JOIN (aggregated payment_records)
    // One row per fee record; amounts in rupees.
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
  app.post("/api/admin/fees/backfill-receipts", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;

    // ── 1. Backfill fee_records (AF prefix) ───────────────────────────────
    const nullFeeRows = await db.execute(
      sql`SELECT id FROM fee_records
          WHERE school_id = ${schoolId}
            AND receipt_number IS NULL
          ORDER BY id ASC`,
    );
    const feeIds = (nullFeeRows.rows as { id: number }[]).map(r => r.id);

    let afCount = 0;
    for (const id of feeIds) {
      const receiptNumber = await storage.nextReceiptNumber("AF");
      await db.execute(
        sql`UPDATE fee_records
            SET receipt_number = ${receiptNumber}
            WHERE id = ${id} AND school_id = ${schoolId}`,
      );
      afCount++;
    }

    // ── 2. Backfill payment_records (OP prefix) ───────────────────────────
    const nullPayRows = await db.execute(
      sql`SELECT id FROM payment_records
          WHERE school_id = ${schoolId}
            AND receipt_number IS NULL
          ORDER BY id ASC`,
    );
    const payIds = (nullPayRows.rows as { id: number }[]).map(r => r.id);

    let opCount = 0;
    for (const id of payIds) {
      const receiptNumber = await storage.nextReceiptNumber("OP");
      await db.execute(
        sql`UPDATE payment_records
            SET receipt_number = ${receiptNumber}
            WHERE id = ${id} AND school_id = ${schoolId}`,
      );
      opCount++;
    }

    await appendAudit(
      req, schoolId, "backfill_receipts", "fee_record", null,
      `Receipt backfill complete: ${afCount} fee record(s) assigned AF numbers, ${opCount} payment record(s) assigned OP numbers`,
    );

    res.json({
      success: true,
      feeRecordsUpdated: afCount,
      paymentRecordsUpdated: opCount,
      message: `Backfill complete: ${afCount} fee record(s) and ${opCount} payment record(s) assigned receipt numbers.`,
    });
  });

  // ── Student: External Portal Info ─────────────────────────────────────────
  app.get("/api/student/fees/portal-info", async (req, res) => {
    if (!req.session?.studentId) return res.status(403).json({ message: "Student access required" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(403).json({ message: "Student not found" });
    const settings = await storage.getExternalPaymentSettings(student.schoolId);
    if (!settings?.isEnabled) {
      return res.json({ isEnabled: false, gatewayUrl: null, bannerMessage: null });
    }
    res.json({ isEnabled: true, gatewayUrl: settings.gatewayUrl, bannerMessage: settings.bannerMessage });
  });
}
