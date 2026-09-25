import type { Express, Request, RequestHandler, Response } from "express";
import Razorpay from "razorpay";
import { sql } from "drizzle-orm";
import { z } from "zod/v4";
import { db } from "./db";
import { storage } from "./storage";
import { acquireRazorpayOrder, settleRazorpayPaymentForFee } from "./fees-routes";

type Principal = { id: number; entityId: number | null; role: string; schoolId: number };
type MobileRequest = Request & {
  mobileAuth?: { principal: Principal };
  mobileAcademicSession?: { id: number; schoolId: number };
};
const idSchema = z.object({ feeRecordId: z.number().int().positive() });
const verifySchema = idSchema.extend({
  razorpayPaymentId: z.string().regex(/^pay_[A-Za-z0-9]+$/),
  razorpayOrderId: z.string().regex(/^order_[A-Za-z0-9]+$/),
});

function student(req: Request, res: Response): Principal | null {
  const p = (req as MobileRequest).mobileAuth?.principal;
  if (!p || p.role !== "student" || p.entityId === null || p.entityId !== p.id) {
    res.status(403).json({ message: "Student access is required." });
    return null;
  }
  return p;
}

async function credentials(schoolId: number) {
  const settings = await storage.getExternalPaymentSettings(schoolId);
  const keyId = settings?.razorpayKeyId ?? process.env.RAZORPAY_KEY_ID;
  const keySecret = settings?.razorpayKeySecret ?? process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret || settings?.razorpayEnabled === false) return null;
  return { keyId, keySecret };
}

async function ownedFee(feeRecordId: number, p: Principal) {
  const result = await db.execute(sql`
    SELECT fr.id, fr.student_id, fr.school_id, fr.session_id
    FROM fee_records fr WHERE fr.id = ${feeRecordId}
      AND fr.student_id = ${p.id} AND fr.school_id = ${p.schoolId} LIMIT 1
  `);
  return result.rows[0] as any;
}

/** Mounted by the mobile-auth route owner with the existing HTTPS/bearer middleware. */
export function registerMobileStudentPaymentRoutes(
  app: Express,
  requireHttps: RequestHandler,
  requireBearer: RequestHandler,
  requireAcademicSession: RequestHandler,
): void {
  const guard = [requireHttps, requireBearer, requireAcademicSession] as const;
  app.post("/api/mobile/student/payments/create-order", ...guard, async (req, res) => {
    const p = student(req, res);
    if (!p) return;
    const parsed = idSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "feeRecordId must be a positive integer." });
    const fee = await ownedFee(parsed.data.feeRecordId, p);
    if (!fee) return res.status(404).json({ message: "Fee record not found." });
    const selected = (req as MobileRequest).mobileAcademicSession;
    if (!selected || selected.schoolId !== p.schoolId || Number(fee.session_id) !== selected.id) {
      return res.status(403).json({ message: "This invoice is outside the selected academic session." });
    }
    if (!fee.session_id) return res.status(403).json({ message: "This invoice is not payable." });
    const active = await db.execute(sql`
      SELECT 1 FROM academic_sessions WHERE id = ${fee.session_id}
      AND school_id = ${p.schoolId} AND is_active = true LIMIT 1
    `);
    if (!active.rows.length) return res.status(403).json({ message: "Archived invoices cannot be paid." });
    const creds = await credentials(p.schoolId);
    if (!creds) return res.status(503).json({ message: "Online payments are not configured for this school." });
    try {
      const rzp = new Razorpay({ key_id: creds.keyId, key_secret: creds.keySecret });
      const result = await acquireRazorpayOrder(parsed.data.feeRecordId, p.schoolId, {
        fetch: id => (rzp.orders as any).fetch(id),
        create: options => (rzp.orders as any).create(options),
      });
      if (!result.ok) return res.status(result.status).json({ message: result.message, code: "code" in result ? result.code : undefined });
      return res.json({ orderId: result.orderId, amount: result.amount, currency: "INR", keyId: creds.keyId });
    } catch {
      return res.status(503).json({ message: "Unable to start payment. Please try again." });
    }
  });

  app.post("/api/mobile/student/payments/verify", ...guard, async (req, res) => {
    const p = student(req, res);
    if (!p) return;
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid Razorpay payment response." });
    const fee = await ownedFee(parsed.data.feeRecordId, p);
    if (!fee) return res.status(404).json({ message: "Fee record not found." });
    const selected = (req as MobileRequest).mobileAcademicSession;
    if (!selected || selected.schoolId !== p.schoolId || Number(fee.session_id) !== selected.id) {
      return res.status(403).json({ message: "This invoice is outside the selected academic session." });
    }
    const creds = await credentials(p.schoolId);
    if (!creds) return res.status(503).json({ message: "Online payments are not configured for this school." });
    const result = await settleRazorpayPaymentForFee({
      feeRecordId: parsed.data.feeRecordId, schoolId: p.schoolId,
      paymentId: parsed.data.razorpayPaymentId, orderId: parsed.data.razorpayOrderId,
      credentials: creds,
    });
    if (!result.ok) return res.status(result.status).json({ message: result.message });
    return res.json({ ok: true, receiptNumber: result.receiptNumber, idempotent: result.idempotent ?? false });
  });
}