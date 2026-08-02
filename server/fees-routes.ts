import type { Express } from "express";
import { storage } from "./storage";
import { db } from "./db";
import { users, schools } from "@shared/schema";
import { eq } from "drizzle-orm";
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

    // Idempotency guard
    if (idempotencyKey) {
      const existing = await storage.getPaymentRecordByIdempotencyKey(idempotencyKey);
      if (existing) return res.status(200).json({ ...existing, idempotent: true });
    }

    const rec = await storage.createPaymentRecord({
      ...paymentData,
      schoolId,
      idempotencyKey: idempotencyKey ?? null,
      recordedBy: req.session.userId,
    });

    // Auto-mark linked fee record as Paid
    if (paymentData.feeRecordId) {
      await storage.updateFeeRecord(paymentData.feeRecordId, schoolId, {
        status: "Paid",
        paidDate: paymentData.receivedDate,
        receiptNumber: rec.id ? `REC-${rec.id}` : undefined,
      });
    }

    await appendAudit(req, schoolId, "payment", "payment_record", rec.id,
      `Recorded ${paymentData.paymentMethod} ₹${paymentData.amount} for student #${paymentData.studentId}`);
    res.status(201).json(rec);
  });

  // ── External Payment Settings ─────────────────────────────────────────────

  const externalSettingsSchema = z.object({
    isEnabled: z.boolean(),
    gatewayUrl: z.string().max(500).optional().nullable(),
    bannerMessage: z.string().max(500).optional().nullable(),
  });

  app.get("/api/admin/fees/external-settings", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const settings = await storage.getExternalPaymentSettings(req.session.schoolId!);
    res.json(settings ?? { isEnabled: false, gatewayUrl: null, bannerMessage: null });
  });

  app.put("/api/admin/fees/external-settings", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const parsed = externalSettingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    const schoolId = req.session.schoolId!;
    const updated = await storage.upsertExternalPaymentSettings(schoolId, {
      ...parsed.data,
      gatewayUrl: parsed.data.gatewayUrl || null,
      bannerMessage: parsed.data.bannerMessage || null,
      lastUpdatedBy: req.session.userId,
    });
    await appendAudit(req, schoolId, "settings_change", "external_settings", null,
      `External payment portal ${parsed.data.isEnabled ? "enabled" : "disabled"}${parsed.data.gatewayUrl ? ` → ${parsed.data.gatewayUrl}` : ""}`);
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
    <tr><td>Receipt No.</td><td>PAY-${payment.id}</td></tr>
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
