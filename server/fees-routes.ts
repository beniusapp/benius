import type { Express } from "express";
import { storage } from "./storage";
import { db } from "./db";
import { calculateLateFee, recalculateLateFees } from "./late-fee-engine";
import { users, schools, students, feeRecords, paymentRecords, notificationConfig, dunningLog, dunningTemplates, externalPaymentSettings, feeStructures, dunningJobStatus } from "@shared/schema";
import { and, eq, sql, desc, or } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import Razorpay from "razorpay";
import { broadcastPaymentUpdate } from "./sse";

// ── Exported for integration testing ─────────────────────────────────────────
// acquireRazorpayOrder contains the atomic lock → check → create → persist
// sequence that the /api/payments/create-order route handler delegates to.
// Extracting it lets tests call the function directly with a mocked Razorpay
// instance without standing up a full HTTP server.
export type AcquireOrderResult =
  | { ok: true;  orderId: string; amount: number }
  | { ok: false; status: 409; code: "PAYMENT_IN_PROGRESS"; message: string }
  | { ok: false; status: 503; code: "ORDER_STATUS_UNKNOWN"; message: string }
  | { ok: false; status: 400 | 404; message: string };

/** Minimal Razorpay orders-API surface consumed by acquireRazorpayOrder. */
export interface RzpOrdersApi {
  /**
   * Fetch a Razorpay order by ID.
   *
   * `status`     — Razorpay lifecycle state ("created" | "attempted" | "expired" | "paid").
   * `created_at` — Unix timestamp (seconds) when the order was created on Razorpay.
   *                Present on every standard order; used as a safe fallback to detect
   *                stale orders on fee records that pre-date the razorpay_order_expires_at
   *                column (legacy rows where the column is NULL).
   */
  fetch(orderId: string): Promise<{ status: string; created_at?: number }>;
  create(opts: {
    amount: number; currency: string; receipt: string;
    notes: Record<string, string>;
  }): Promise<{ id: string }>;
}

/**
 * Checkout window duration (seconds) — must match the `timeout` value
 * configured in the Razorpay checkout modal on the client.  When a new
 * Razorpay order is created we persist NOW() + this offset as
 * razorpay_order_expires_at so subsequent requests can detect that the
 * checkout window has elapsed even though Razorpay still shows the order
 * as "created" (Razorpay does not expose an expire_by field on orders
 * created via the standard checkout flow).
 */
const CHECKOUT_TIMEOUT_SECONDS = 600;

/**
 * Atomically checks for an in-progress Razorpay order on the given fee record
 * and, if none is open, creates a new one and persists its ID.
 *
 * Uses SELECT … FOR UPDATE so two concurrent HTTP requests for the same fee row
 * are serialised: the second request blocks until the first commits the new
 * razorpay_order_id, then reads it and returns 409 instead of creating a
 * duplicate order.
 */
export async function acquireRazorpayOrder(
  feeRecordId: number,
  schoolId: number,
  rzpOrders: RzpOrdersApi,
): Promise<AcquireOrderResult> {
  let result: AcquireOrderResult | null = null;

  await db.transaction(async (tx) => {
    // Row-level write lock — concurrent requests for this fee block here.
    const lockedResult = await tx.execute(sql`
      SELECT id, status, amount, late_fee_amount, razorpay_order_id, razorpay_order_expires_at
      FROM fee_records
      WHERE id = ${feeRecordId} AND school_id = ${schoolId}
      FOR UPDATE
    `);
    const locked = lockedResult.rows[0] as any;
    if (!locked) {
      result = { ok: false, status: 404, message: "Fee record not found" };
      return;
    }

    // Re-check payable status under lock — a concurrent webhook may have just
    // marked this fee Paid between the pre-flight read and now.
    if (!["Due", "Overdue", "Partial"].includes(locked.status)) {
      result = { ok: false, status: 400, message: `Fee is not payable (status: ${locked.status})` };
      return;
    }

    // If a Razorpay order already exists on this record, verify its lifecycle
    // before deciding whether to allow a new order.
    //
    // Razorpay order states:
    //   "created"   → checkout window open, no attempt yet             → BLOCK
    //   "attempted" → payment attempt made, window still live          → BLOCK
    //   "expired"   → Razorpay closed the order (definitively terminal) → allow
    //   "paid"      → payment captured (definitively terminal)          → allow
    //
    // Fetch errors (network, 5xx, timeout) are treated as BLOCK because we
    // cannot distinguish a live order from a stale one.  Silently falling
    // through to create a second order while the first's state is unknown
    // risks a duplicate charge, which is worse than a brief retry delay.
    if (locked.razorpay_order_id) {
      let existingStatus: string | null = null;
      let existingCreatedAt: number | undefined;
      let fetchError = false;

      try {
        const existing = await rzpOrders.fetch(locked.razorpay_order_id as string);
        existingStatus    = existing.status;
        existingCreatedAt = existing.created_at;
      } catch {
        fetchError = true;
      }

      if (fetchError) {
        // Razorpay is unreachable or returned an unexpected error.  Fail safe:
        // preserve the known order ID and ask the student to retry shortly.
        result = {
          ok: false, status: 503, code: "ORDER_STATUS_UNKNOWN",
          message: "Unable to verify your existing payment status. Please try again in a moment.",
        };
        return;
      }

      if (existingStatus === "attempted") {
        // A payment attempt has been submitted for this order.
        //
        // Safety window: within the checkout timeout, a capture or webhook can
        // still complete after the modal closes — block to prevent a duplicate.
        //
        // However once the application-side checkout deadline has passed AND no
        // capture has been recorded in our system, the attempt is definitively
        // abandoned. Razorpay will expire the order; we clear the lock early so
        // the student can retry without waiting for Razorpay's own expiry job.
        const rawExpiry = locked.razorpay_order_expires_at;
        let isCheckoutWindowElapsed = false;
        if (rawExpiry) {
          isCheckoutWindowElapsed = new Date(rawExpiry as string).getTime() < Date.now();
        } else if (typeof existingCreatedAt === "number") {
          isCheckoutWindowElapsed = (Date.now() / 1000 - existingCreatedAt) > CHECKOUT_TIMEOUT_SECONDS;
        }

        if (!isCheckoutWindowElapsed) {
          // Still within the safety window — block.
          result = {
            ok: false, status: 409, code: "PAYMENT_IN_PROGRESS",
            message: "A payment was already submitted for this fee. If it was successful, the status will update automatically — please check back in a few minutes.",
          };
          return;
        }
        // Checkout window elapsed — clear the stale order and fall through to create a fresh one.
        console.log(
          `[razorpay create-order] Clearing stale attempted order ${locked.razorpay_order_id} ` +
          `on fee #${feeRecordId} (checkout window elapsed)`
        );
        await tx.execute(sql`
          UPDATE fee_records
          SET razorpay_order_id = NULL, razorpay_order_expires_at = NULL
          WHERE id = ${feeRecordId} AND school_id = ${schoolId}
        `);
      }

      if (existingStatus === "created") {
        // No payment attempt yet — the student opened checkout but never
        // submitted a card.  Detect a stale checkout window and allow a retry.
        //
        // Primary signal: application-owned razorpay_order_expires_at column,
        // persisted at order-creation time as NOW() + CHECKOUT_TIMEOUT_SECONDS.
        //
        // Fallback for legacy rows (razorpay_order_expires_at IS NULL): use the
        // Razorpay order's created_at Unix timestamp, which is returned by every
        // standard Orders fetch.  If the order is older than
        // CHECKOUT_TIMEOUT_SECONDS, the checkout modal will have auto-closed.
        //
        // If neither signal is available, err on the side of caution (block).
        const rawExpiry = locked.razorpay_order_expires_at;
        let isCheckoutWindowElapsed: boolean;

        if (rawExpiry) {
          // Stored deadline — authoritative for orders created post-deployment.
          isCheckoutWindowElapsed = new Date(rawExpiry as string).getTime() < Date.now();
        } else if (typeof existingCreatedAt === "number") {
          // Legacy row: derive deadline from Razorpay's own order timestamp.
          const orderAgeSeconds = Date.now() / 1000 - existingCreatedAt;
          isCheckoutWindowElapsed = orderAgeSeconds > CHECKOUT_TIMEOUT_SECONDS;
        } else {
          // Neither signal available — cannot safely determine age.
          isCheckoutWindowElapsed = false;
        }

        if (!isCheckoutWindowElapsed) {
          // Compute how many minutes remain so the student knows when to retry.
          let minutesLeft = 10;
          if (rawExpiry) {
            minutesLeft = Math.max(1, Math.ceil((new Date(rawExpiry as string).getTime() - Date.now()) / 60_000));
          } else if (typeof existingCreatedAt === "number") {
            const elapsedSeconds = Date.now() / 1000 - existingCreatedAt;
            minutesLeft = Math.max(1, Math.ceil((CHECKOUT_TIMEOUT_SECONDS - elapsedSeconds) / 60));
          }
          const minLabel = `${minutesLeft} minute${minutesLeft !== 1 ? "s" : ""}`;
          result = {
            ok: false, status: 409, code: "PAYMENT_IN_PROGRESS",
            message: `A payment window is already open for this fee. Please try again in ${minLabel}.`,
          };
          return;
        }
        // Checkout window definitively elapsed → fall through to create a fresh order.
      }

      // "expired", "paid", or checkout-window-elapsed "created" — terminal;
      // safe to create a fresh order for this fee record.
    }

    // Create the order while holding the row lock.  Any concurrent request for
    // this fee is blocked here until this transaction commits.
    const lateFeeForOrder = Number(locked.late_fee_amount ?? 0);
    const amountPaise = Math.round((Number(locked.amount) + lateFeeForOrder) * 100);
    const order = await rzpOrders.create({
      amount: amountPaise,
      currency: "INR",
      receipt: `fee_${feeRecordId}`,
      notes: { feeRecordId: String(feeRecordId), schoolId: String(schoolId) },
    });

    // Persist the order ID and checkout deadline inside the transaction so they
    // become visible to the next concurrent request the moment we commit.
    // razorpay_order_expires_at mirrors the client's checkout modal timeout
    // (CHECKOUT_TIMEOUT_SECONDS) and lets a subsequent request detect that the
    // checkout window has elapsed even though Razorpay still shows "created".
    const orderExpiresAt = new Date(Date.now() + CHECKOUT_TIMEOUT_SECONDS * 1_000);
    const updateResult = await tx.execute(sql`
      UPDATE fee_records
      SET razorpay_order_id         = ${order.id},
          razorpay_order_expires_at = ${orderExpiresAt.toISOString()}
      WHERE id = ${feeRecordId} AND school_id = ${schoolId}
    `);
    if ((updateResult.rowCount ?? 0) === 0) {
      console.error(`[razorpay create-order] persist: no row updated fee #${feeRecordId} school #${schoolId}`);
    }

    result = { ok: true, orderId: order.id, amount: amountPaise };
  });

  return result!;
}

export function registerFeesRoutes(app: Express) {

  // ── Razorpay credential resolver ─────────────────────────────────────────────
  // Reads DB settings first; falls back to process.env when DB fields are absent.
  // Returns null when no credentials can be found anywhere.
  async function resolveRazorpayCredentials(schoolId: number): Promise<{
    keyId: string;
    keySecret: string;
    webhookSecret: string | null;
    enabled: boolean;
  } | null> {
    const settings = await storage.getExternalPaymentSettings(schoolId);
    const keyId      = settings?.razorpayKeyId      ?? process.env.RAZORPAY_KEY_ID      ?? null;
    const keySecret  = settings?.razorpayKeySecret  ?? process.env.RAZORPAY_KEY_SECRET  ?? null;
    const webhookSec = settings?.razorpayWebhookSecret ?? process.env.RAZORPAY_WEBHOOK_SECRET ?? null;
    const enabled    = settings?.razorpayEnabled ?? (!!keyId && !!keySecret);
    if (!keyId || !keySecret) return null;
    return { keyId, keySecret, webhookSecret: webhookSec, enabled };
  }

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
    studentId?: number | null,
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
        studentId: studentId ?? null,
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

  // ── GET /api/fees/analytics ──────────────────────────────────────────────
  app.get("/api/fees/analytics", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const viewSessionId: number | null = (req as any).viewSessionId ?? null;
    const sessionId = viewSessionId ?? (await storage.getActiveSession(schoolId))?.id ?? null;

    // ── Fetch session boundaries first — used for time-series date range ──
    let sessionInfo: { startDate: string; endDate: string; sessionName: string } | null = null;
    if (sessionId) {
      const sesRow = await db.execute(sql`
        SELECT start_date, end_date, session_name
        FROM academic_sessions WHERE id = ${sessionId} LIMIT 1
      `);
      const s = sesRow.rows[0] as any;
      if (s) {
        sessionInfo = {
          startDate:   String(s.start_date).slice(0, 10),
          endDate:     String(s.end_date).slice(0, 10),
          sessionName: String(s.session_name),
        };
      }
    }

    // NOTE: We do NOT filter the time-series by received_date/due_date against
    // the session's date boundaries. Payments can legitimately arrive before a
    // session's official start (advance payments, test data, admin backdating).
    // Session scoping is already enforced by the fee_record join (sfFR / sfFR2).
    // Without a session we fall back to a 36-month rolling window so the query
    // stays bounded even across all-school unscoped calls.
    const tsDateMC = sessionId
      ? sql``
      : sql` AND pr.received_date::date >= CURRENT_DATE - INTERVAL '36 months'`;
    const tsDateMB = sessionId
      ? sql``
      : sql` AND fr.due_date::date >= CURRENT_DATE - INTERVAL '36 months'`;

    // Session filter on fee_records (fr alias)
    const sfFR  = sessionId ? sql` AND fr.session_id  = ${sessionId}` : sql``;
    // Session filter on fee_records (fr2 alias) — used in payment joins
    const sfFR2 = sessionId ? sql` AND fr2.session_id = ${sessionId}` : sql``;

    // Shared sub-query: payments aggregated per fee record (all sessions —
    // outer query controls session scope via fee_records filter).
    const paidSub = (sid: number) => sql`
      SELECT fee_record_id,
        SUM(amount)::int       AS paid,
        SUM(late_fee_paid)::int AS late_fees
      FROM payment_records
      WHERE school_id = ${sid} AND fee_record_id IS NOT NULL
      GROUP BY fee_record_id`;

    try {
      const [billedRow, payRow, outRow, tsRow, cwRow, chRow, catRow, agRow] = await Promise.all([
        // ── 1a. Gross billed (base + accrued late fees) ───────────────────
        db.execute(sql`
          SELECT COALESCE(SUM(fr.amount + fr.late_fee_amount), 0)::int AS gross_billed
          FROM fee_records fr
          WHERE fr.school_id = ${schoolId}${sfFR}
        `),
        // ── 1b. Payment totals — filter by fee_record's session, NOT by
        //        the session stamped on the payment row (which can be wrong
        //        when simulate-pay stamps the active session on old records).
        db.execute(sql`
          SELECT
            COALESCE(SUM(p.paid),      0)::int AS total_collected,
            COALESCE(SUM(p.late_fees), 0)::int AS total_late_fees
          FROM fee_records fr
          JOIN (${paidSub(schoolId)}) p ON p.fee_record_id = fr.id
          WHERE fr.school_id = ${schoolId}${sfFR}
        `),
        // ── 1c. Outstanding ───────────────────────────────────────────────
        db.execute(sql`
          SELECT COALESCE(SUM(GREATEST(fr.amount + fr.late_fee_amount - COALESCE(p.paid,0), 0)), 0)::int AS outstanding
          FROM fee_records fr
          LEFT JOIN (${paidSub(schoolId)}) p ON p.fee_record_id = fr.id
          WHERE fr.school_id = ${schoolId}
            AND fr.status IN ('Due','Overdue','Partial')${sfFR}
        `),
        // ── 2. Time-series — bounded by session start/end dates so every
        //        school's full academic year is always covered regardless of
        //        when the query runs. Client slices/aggregates for each view.
        db.execute(sql`
          WITH mc AS (
            SELECT DATE_TRUNC('month', pr.received_date::date) AS pd,
                   COALESCE(SUM(pr.amount), 0)::int AS collected
            FROM payment_records pr
            JOIN fee_records fr2 ON fr2.id = pr.fee_record_id
            WHERE pr.school_id = ${schoolId}
              AND pr.received_date IS NOT NULL
              ${tsDateMC}
              AND fr2.school_id = ${schoolId}${sfFR2}
            GROUP BY pd
          ),
          mb AS (
            SELECT DATE_TRUNC('month', fr.due_date::date) AS pd,
                   COALESCE(SUM(fr.amount), 0)::int AS billed
            FROM fee_records fr
            WHERE fr.school_id = ${schoolId}
              AND fr.due_date IS NOT NULL
              ${tsDateMB}
              ${sfFR}
            GROUP BY pd
          )
          SELECT
            TO_CHAR(COALESCE(mc.pd, mb.pd), 'Mon ''YY') AS period,
            COALESCE(mc.pd, mb.pd)                        AS period_date,
            COALESCE(mc.collected, 0)                     AS collected,
            COALESCE(mb.billed, 0)                        AS billed
          FROM mc FULL OUTER JOIN mb ON mc.pd = mb.pd
          ORDER BY period_date ASC
        `),
        // ── 3. Class-wise breakdown — outstanding includes late_fee_amount
        db.execute(sql`
          SELECT s.class,
            COALESCE(SUM(fr.amount + fr.late_fee_amount), 0)::int                                          AS billed,
            COALESCE(SUM(COALESCE(p.paid, 0)), 0)::int                                                     AS collected,
            COALESCE(SUM(GREATEST(fr.amount + fr.late_fee_amount - COALESCE(p.paid, 0), 0)), 0)::int       AS outstanding
          FROM fee_records fr
          JOIN students s ON s.id = fr.student_id
          LEFT JOIN (${paidSub(schoolId)}) p ON p.fee_record_id = fr.id
          WHERE fr.school_id = ${schoolId}${sfFR}
          GROUP BY s.class
          ORDER BY CASE WHEN s.class ~ '^[0-9]+$' THEN s.class::int ELSE 999 END, s.class
        `),
        // ── 4. Payment channel — session-scoped via fee_record join
        db.execute(sql`
          SELECT pr.payment_method,
            COUNT(*)::int                   AS count,
            COALESCE(SUM(pr.amount), 0)::int AS amount
          FROM payment_records pr
          JOIN fee_records fr2 ON fr2.id = pr.fee_record_id
          WHERE pr.school_id = ${schoolId}
            AND fr2.school_id = ${schoolId}${sfFR2}
          GROUP BY pr.payment_method
          ORDER BY amount DESC
        `),
        // ── 5. Fee category ───────────────────────────────────────────────
        db.execute(sql`
          SELECT fr.fee_type,
            COALESCE(SUM(fr.amount + fr.late_fee_amount), 0)::int AS billed,
            COALESCE(SUM(COALESCE(p.paid, 0)), 0)::int            AS collected
          FROM fee_records fr
          LEFT JOIN (${paidSub(schoolId)}) p ON p.fee_record_id = fr.id
          WHERE fr.school_id = ${schoolId}${sfFR}
          GROUP BY fr.fee_type ORDER BY billed DESC LIMIT 10
        `),
        // ── 6. AR Aging ───────────────────────────────────────────────────
        db.execute(sql`
          SELECT
            CASE
              WHEN CURRENT_DATE - fr.due_date::date BETWEEN 1  AND 30 THEN '1-30'
              WHEN CURRENT_DATE - fr.due_date::date BETWEEN 31 AND 60 THEN '31-60'
              WHEN CURRENT_DATE - fr.due_date::date BETWEEN 61 AND 90 THEN '61-90'
              WHEN CURRENT_DATE - fr.due_date::date > 90              THEN '90+'
            END AS bucket,
            COUNT(*)::int AS count,
            COALESCE(SUM(GREATEST(fr.amount + fr.late_fee_amount - COALESCE(p.paid, 0), 0)), 0)::int AS amount
          FROM fee_records fr
          LEFT JOIN (${paidSub(schoolId)}) p ON p.fee_record_id = fr.id
          WHERE fr.school_id = ${schoolId}
            AND fr.status IN ('Due','Overdue','Partial')
            AND fr.due_date IS NOT NULL
            AND CURRENT_DATE > fr.due_date::date
            ${sfFR}
          GROUP BY bucket
        `),
      ]);

      const grossBilled        = Number(billedRow.rows[0]?.gross_billed     ?? 0);
      const netCollected       = Number(payRow.rows[0]?.total_collected      ?? 0);
      const totalLatePenalties = Number(payRow.rows[0]?.total_late_fees      ?? 0);
      const outstanding        = Number(outRow.rows[0]?.outstanding          ?? 0);
      // Cap at 100 % — over-collection (advance payments) shows as 100 %
      const collectionRate     = grossBilled > 0
        ? Math.min(100, Math.round((netCollected / grossBilled) * 100))
        : 0;

      res.json({
        sessionInfo,
        summary: { grossBilled, netCollected, outstanding, collectionRate, totalDiscounts: 0, totalLatePenalties },
        timeSeries:      tsRow.rows,
        classWise:       cwRow.rows,
        paymentChannels: chRow.rows,
        feeCategories:   catRow.rows,
        aging:           agRow.rows,
      });
    } catch (err: any) {
      console.error("[fees/analytics]", err);
      res.status(500).json({ message: String(err) });
    }
  });

  // ── Fee Structures ────────────────────────────────────────────────────────

  const breakdownItemSchema = z.object({
    name:    z.string().min(1).max(100),
    purpose: z.string().max(300).default(""),
    amount:  z.number().int().min(0),
  });

  const tieredSlabSchema = z.object({
    from_day: z.number().int().min(1),
    to_day:   z.number().int().min(1),
    amount:   z.number().int().min(0),
  });

  const lateFeeConfigSchema = z.object({
    enabled:           z.boolean().default(false),
    type:              z.enum(["NONE", "FLAT", "DAILY", "TIERED"]).default("NONE"),
    grace_period_days: z.number().int().min(0).default(0),
    flat_amount:       z.number().int().min(0).default(0),
    daily_rate:        z.number().min(0).default(0),
    max_cap:           z.number().int().min(0).default(0),
    tiered_slabs:      z.array(tieredSlabSchema).default([]),
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
    lateFeeConfig: lateFeeConfigSchema.optional(),
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
    recalculateLateFees(schoolId).catch(() => {/* non-critical */});
    res.status(201).json(rec);
  });

  app.patch("/api/admin/fees/structures/:id", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const parsed = structureBodySchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    const schoolId = req.session.schoolId!;

    // Read the current structure before updating so we can detect amount changes
    const before = await storage.getFeeStructureById(id, schoolId);
    if (!before) return res.status(404).json({ message: "Fee structure not found" });

    const updated = await storage.updateFeeStructure(id, schoolId, parsed.data);
    if (!updated) return res.status(404).json({ message: "Fee structure not found" });

    // Sync ALL snapshot fields on unpaid (Due / Overdue) fee records so the
    // ledger always reflects the current structure data after any save.
    const amountChanged     = parsed.data.amount        !== undefined && parsed.data.amount        !== before.amount;
    const feeTypeChanged    = parsed.data.feeType       !== undefined && parsed.data.feeType       !== before.feeType;
    const dueDayChanged     = parsed.data.dueDayOfMonth !== undefined && parsed.data.dueDayOfMonth !== null
                              && parsed.data.dueDayOfMonth !== before.dueDayOfMonth;

    let syncedCount = 0;

    // 1. Sync amount + feeType in a single UPDATE
    if (amountChanged || feeTypeChanged) {
      const patch: Record<string, unknown> = {};
      if (amountChanged)  patch.amount  = parsed.data.amount;
      if (feeTypeChanged) patch.feeType = parsed.data.feeType;

      const result = await db.update(feeRecords)
        .set(patch as any)
        .where(and(
          eq(feeRecords.schoolId, schoolId),
          eq(feeRecords.feeType, before.feeType),           // match by OLD feeType
          or(eq(feeRecords.status, "Due"), eq(feeRecords.status, "Overdue"))
        ))
        .returning({ id: feeRecords.id });
      syncedCount = result.length;
    }

    // 2. Sync due date — replace the day component while keeping the existing
    //    month + year.  LEAST(newDay, days_in_month) prevents invalid dates
    //    e.g. day 31 in a 30-day month.
    if (dueDayChanged) {
      const newDay = parsed.data.dueDayOfMonth!;
      // Use the (possibly already-updated) feeType when matching records
      const matchFeeType = feeTypeChanged ? parsed.data.feeType! : before.feeType;
      const dueDateResult = await db.execute(sql`
        UPDATE fee_records
        SET due_date = MAKE_DATE(
          EXTRACT(YEAR  FROM due_date)::int,
          EXTRACT(MONTH FROM due_date)::int,
          LEAST(
            ${newDay}::int,
            EXTRACT(DAY FROM (DATE_TRUNC('month', due_date) + INTERVAL '1 month' - INTERVAL '1 day'))::int
          )
        )
        WHERE school_id   = ${schoolId}
          AND fee_type    = ${matchFeeType}
          AND status IN ('Due', 'Overdue')
        RETURNING id
      `);
      // Avoid double-counting if amount/feeType was also changed in the same save
      if (!amountChanged && !feeTypeChanged) {
        syncedCount = (dueDateResult.rows ?? []).length;
      }
    }

    // 3. Void out-of-scope Due/Overdue records when applicableClasses narrows.
    //    When a structure's class list is tightened, existing invoices for students
    //    who no longer qualify must be removed so the ledger stays accurate.
    let voidedCount = 0;
    const newClasses: string[] | undefined = parsed.data.applicableClasses;
    if (newClasses !== undefined && newClasses.length > 0) {
      // Fetch all Due/Overdue records for this feeType in this school
      const matchFeeTypeForVoid = feeTypeChanged ? parsed.data.feeType! : before.feeType;
      const unpaidRecs = await db.select({ id: feeRecords.id, studentId: feeRecords.studentId })
        .from(feeRecords)
        .where(and(
          eq(feeRecords.schoolId, schoolId),
          eq(feeRecords.feeType, matchFeeTypeForVoid),
          or(eq(feeRecords.status, "Due"), eq(feeRecords.status, "Overdue"))
        ));
      // Resolve each student's current class directly from the Student Registry
      // (global, session-independent — the correct source of truth for current class).
      if (unpaidRecs.length > 0) {
        const activeStudents = await storage.getStudentsBySchool(schoolId);
        const classMap = new Map(activeStudents.map(s => [s.id, s.class]));
        const toVoid = unpaidRecs.filter(r => {
          const cls = classMap.get(r.studentId);
          return !cls || !newClasses.includes(cls);
        });
        if (toVoid.length > 0) {
          const toVoidIds = toVoid.map(r => r.id);
          await db.delete(feeRecords)
            .where(and(
              eq(feeRecords.schoolId, schoolId),
              sql`id = ANY(${sql.raw(`ARRAY[${toVoidIds.join(",")}]`)})`,
              or(eq(feeRecords.status, "Due"), eq(feeRecords.status, "Overdue"))
            ));
          voidedCount = toVoid.length;
        }
      }
    }

    const syncParts: string[] = [];
    if (amountChanged)  syncParts.push(`amount → ₹${parsed.data.amount}`);
    if (feeTypeChanged) syncParts.push(`fee type → ${parsed.data.feeType}`);
    if (dueDayChanged)  syncParts.push(`due day → ${parsed.data.dueDayOfMonth}th`);
    if (voidedCount > 0) syncParts.push(`voided ${voidedCount} out-of-scope invoice(s)`);
    const syncNote = (syncedCount > 0 || voidedCount > 0)
      ? ` — ${syncParts.join("; ")}`
      : "";
    await appendAudit(req, schoolId, "update", "fee_structure", id,
      `Updated fee structure: ${updated.name}${syncNote}`);

    // Re-run late fee calculation for this school after any structure change
    recalculateLateFees(schoolId).catch(() => {/* non-critical */});

    res.json({ ...updated, syncedInvoices: syncedCount, voidedInvoices: voidedCount, syncedFields: syncParts });
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
    // FIFO mode: when true and feeRecordId is null, funds are auto-allocated to the
    // student's unpaid invoices oldest-first (due_date ASC) rather than freeform.
    autoFifo: z.boolean().default(false),
    // Fee record fields — used to auto-create a fee record when feeRecordId is null and autoFifo is false
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
    lateFeePaid: z.number().int().min(0).default(0),
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

    // ── FIFO AUTO-ALLOCATION ──────────────────────────────────────────────────
    // When autoFifo=true the payment amount is spread across the student's unpaid
    // invoices, oldest due-date first.  Each invoice gets its own payment_record
    // and its status is updated atomically inside a single transaction.
    if (paymentData.autoFifo && !paymentData.feeRecordId) {
      // Fetch unpaid invoices ordered oldest-first; compute per-invoice net balance
      const unpaidRows = await db.execute(sql`
        SELECT
          fr.id,
          fr.amount,
          fr.due_date,
          fr.session_id,
          COALESCE(p.total_paid, 0)::int AS amount_paid,
          GREATEST(fr.amount - COALESCE(p.total_paid, 0), 0)::int AS balance
        FROM fee_records fr
        LEFT JOIN (
          SELECT fee_record_id, SUM(amount)::int AS total_paid
          FROM payment_records
          WHERE school_id = ${schoolId} AND fee_record_id IS NOT NULL
          GROUP BY fee_record_id
        ) p ON p.fee_record_id = fr.id
        WHERE fr.student_id = ${paymentData.studentId}
          AND fr.school_id  = ${schoolId}
          AND fr.status IN ('Due', 'Overdue', 'Partial')
        HAVING GREATEST(fr.amount - COALESCE(p.total_paid, 0), 0) > 0
        ORDER BY fr.due_date ASC, fr.id ASC
      `);

      const invoices = unpaidRows.rows as Array<{
        id: number; amount: number; due_date: string;
        session_id: number | null; amount_paid: number; balance: number;
      }>;

      if (invoices.length === 0) {
        return res.status(400).json({ message: "No unpaid invoices found for this student to allocate against." });
      }

      // Build allocation plan (oldest-first)
      let remaining = paymentData.amount;
      const plan: Array<{ invoiceId: number; allocation: number; sessionId: number | null }> = [];
      for (const inv of invoices) {
        if (remaining <= 0) break;
        const allocation = Math.min(remaining, Number(inv.balance));
        plan.push({ invoiceId: inv.id, allocation, sessionId: inv.session_id });
        remaining -= allocation;
      }

      // Execute the plan atomically
      const results: Array<{ feeRecordId: number; amount: number; receiptNumber: string; newStatus: string }> = [];

      await db.transaction(async (tx) => {
        for (const step of plan) {
          const opReceipt = await storage.nextReceiptNumber(schoolId, "OP");

          // Acquire row-level lock to prevent concurrent over-payment
          const lockedRow = await tx.execute(sql`
            SELECT amount FROM fee_records
            WHERE id = ${step.invoiceId} AND school_id = ${schoolId}
            FOR UPDATE
          `);
          const invoiceAmount = Number((lockedRow.rows[0] as any)?.amount) || 0;

          // Sum already-paid (including any sibling steps in this same tx that committed before)
          const paidSoFar = await tx.execute(sql`
            SELECT COALESCE(SUM(amount), 0)::int AS total_paid
            FROM payment_records
            WHERE fee_record_id = ${step.invoiceId}
          `);
          const alreadyPaid = Number((paidSoFar.rows[0] as any)?.total_paid) || 0;

          // Safety cap — never exceed invoice amount in FIFO mode
          const safeAllocation = Math.min(step.allocation, Math.max(0, invoiceAmount - alreadyPaid));
          if (safeAllocation <= 0) continue;

          await tx.execute(sql`
            INSERT INTO payment_records
              (school_id, session_id, fee_record_id, student_id, payment_method,
               reference_number, received_date, amount, cashier_notes,
               idempotency_key, recorded_by, receipt_number, late_fee_paid)
            VALUES (
              ${schoolId}, ${step.sessionId}, ${step.invoiceId},
              ${paymentData.studentId}, ${paymentData.paymentMethod},
              ${paymentData.referenceNumber ?? null}, ${paymentData.receivedDate},
              ${safeAllocation},
              ${paymentData.cashierNotes ?? null},
              ${idempotencyKey ? `${idempotencyKey}-${step.invoiceId}` : null},
              ${req.session.userId ?? null}, ${opReceipt}, 0
            )
          `);

          const newTotal = alreadyPaid + safeAllocation;
          const newStatus = newTotal >= invoiceAmount ? "Paid" : "Partial";
          await tx.execute(sql`
            UPDATE fee_records
            SET status       = ${newStatus},
                paid_date    = ${paymentData.receivedDate},
                receipt_number = ${opReceipt}
            WHERE id = ${step.invoiceId} AND school_id = ${schoolId}
          `);

          results.push({ feeRecordId: step.invoiceId, amount: safeAllocation, receiptNumber: opReceipt, newStatus });
        }
      });

      const totalAllocated = results.reduce((s, r) => s + r.amount, 0);
      const [fifoStu] = await db.select({ name: students.name }).from(students).where(eq(students.id, paymentData.studentId));
      const fifoStuLabel = fifoStu?.name ?? `Student #${paymentData.studentId}`;
      await appendAudit(req, schoolId, "fifo_payment", "payment_record", null,
        `FIFO payment ₹${totalAllocated.toLocaleString("en-IN")} (${paymentData.paymentMethod}) allocated across ${results.length} invoice(s) for ${fifoStuLabel} — receipts: ${results.map(r => r.receiptNumber).join(", ")}`,
        paymentData.studentId);

      return res.status(201).json({ fifo: true, allocations: results, totalAllocated, unallocated: remaining });
    }
    // ─────────────────────────────────────────────────────────────────────────

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
               idempotency_key, recorded_by, receipt_number, late_fee_paid)
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
              ${opReceipt},
              ${paymentData.lateFeePaid ?? 0}
            )
            RETURNING *`,
      );
      rec = insertResult.rows[0];

      // Auto-update linked fee record status (sum includes the row just inserted)
      // Also persist any notes the admin edited in the Pay modal.
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
          const notesPatch = _fn != null ? sql`, notes = ${_fn}` : sql``;
          await tx.execute(
            sql`UPDATE fee_records
                SET status = ${newStatus},
                    paid_date = ${paymentOnly.receivedDate},
                    receipt_number = ${opReceipt}
                    ${notesPatch}
                WHERE id = ${paymentOnly.feeRecordId} AND school_id = ${schoolId}`,
          );
        }
      }
    });
    // ─────────────────────────────────────────────────────────────────────────

    // Resolve student name once for all payment audit entries below
    const [paymentStu] = await db.select({ name: students.name, cls: students.class, section: students.section })
      .from(students).where(eq(students.id, paymentOnly.studentId));
    const paymentStuLabel = paymentStu
      ? `${paymentStu.name} (${paymentStu.cls ?? ""}${paymentStu.section ? "-" + paymentStu.section : ""})`
      : `Student #${paymentOnly.studentId}`;

    // TypeScript cannot track mutations to `let` variables that happen inside
    // async callbacks (the transaction lambda), so it infers `overpaymentBlock`
    // as the literal type `null` after the await, making the if-body unreachable.
    // Restore the declared union type with an explicit cast so the narrowing works.
    type OverpaymentBlock = { message: string; invoiceAmount: number; totalAlreadyPaid: number; newAmount: number };
    const overpaymentBlockSnap = overpaymentBlock as OverpaymentBlock | null;
    if (overpaymentBlockSnap) {
      await appendAudit(
        req, schoolId, "blocked_payment", "payment_record", paymentOnly.feeRecordId ?? null,
        `Blocked overpayment attempt: ₹${overpaymentBlockSnap.newAmount.toLocaleString("en-IN")} for ${paymentStuLabel} — invoice ₹${overpaymentBlockSnap.invoiceAmount.toLocaleString("en-IN")}, already paid ₹${overpaymentBlockSnap.totalAlreadyPaid.toLocaleString("en-IN")}`,
        paymentOnly.studentId,
      );
      return res.status(400).json({ ...overpaymentBlockSnap, overpaymentGuard: true });
    }

    await appendAudit(req, schoolId, "payment", "payment_record", rec?.id ?? null,
      `Recorded ${paymentOnly.paymentMethod} ₹${Number(paymentOnly.amount).toLocaleString("en-IN")} for ${paymentStuLabel} — receipt ${opReceipt}`,
      paymentOnly.studentId);
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
    // No prefix validation — both rzp_test_* and rzp_live_* keys are accepted.
  });

  app.get("/api/admin/fees/external-settings", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const settings = await storage.getExternalPaymentSettings(schoolId);

    // Resolve effective credentials (DB first, env-var fallback).
    // This makes the admin UI accurately reflect what the system will actually
    // use — including when only process.env.RAZORPAY_* vars are set (no DB save
    // needed on a local dev machine or fresh deployment).
    const creds = await resolveRazorpayCredentials(schoolId);

    const base = settings ?? {
      isEnabled: false, gatewayUrl: null, bannerMessage: null,
      maxOvercollectionPercent: 150, razorpayEnabled: false,
      razorpayKeyId: null, razorpayKeySecret: null, razorpayWebhookSecret: null,
    };

    // Key ID is not a secret — safe to show.  Secrets are always masked.
    const effectiveKeyId = settings?.razorpayKeyId ?? (creds ? (process.env.RAZORPAY_KEY_ID ?? null) : null);

    res.json({
      ...base,
      razorpayMode: "live",
      razorpayEnabled:       creds?.enabled ?? false,
      razorpayKeyId:         effectiveKeyId,
      razorpayKeySecret:     creds ? "••••••••" : null,
      razorpayWebhookSecret: creds?.webhookSecret ? "••••••••" : null,
    });
  });

  app.put("/api/admin/fees/external-settings", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const parsed = externalSettingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    const schoolId = req.session.schoolId!;
    const previous = await storage.getExternalPaymentSettings(schoolId);

    const keyIdToSave = parsed.data.razorpayKeyId || null;

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
      razorpayKeyId: keyIdToSave,
      ...(keySecret !== undefined ? { razorpayKeySecret: keySecret } : {}),
      ...(webhookSecret !== undefined ? { razorpayWebhookSecret: webhookSecret } : {}),
      razorpayMode: "live",
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

  // ── Save Razorpay settings only ──────────────────────────────────────────
  const razorpaySettingsSchema = z.object({
    razorpayEnabled:       z.boolean(),
    razorpayKeyId:         z.string().max(200).optional().nullable(),
    razorpayKeySecret:     z.string().max(500).optional().nullable(),
    razorpayWebhookSecret: z.string().max(500).optional().nullable(),
    // razorpayMode field removed — both test and live key prefixes are accepted
  });

  app.put("/api/admin/fees/external-settings/razorpay", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const parsed = razorpaySettingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    const schoolId = req.session.schoolId!;
    const previous = await storage.getExternalPaymentSettings(schoolId);

    const keyIdToSave = parsed.data.razorpayKeyId || null;

    const keySecret     = parsed.data.razorpayKeySecret     === "••••••••" ? undefined : (parsed.data.razorpayKeySecret     || null);
    const webhookSecret = parsed.data.razorpayWebhookSecret === "••••••••" ? undefined : (parsed.data.razorpayWebhookSecret || null);

    // Validate: if enabling, Key ID must be present (new or existing)
    const effectiveKeyId = keyIdToSave ?? previous?.razorpayKeyId ?? null;
    if (parsed.data.razorpayEnabled && !effectiveKeyId) {
      return res.status(400).json({ message: "Key ID is required before enabling Razorpay." });
    }

    const updated = await storage.upsertExternalPaymentSettings(schoolId, {
      isEnabled:                previous?.isEnabled ?? false,
      gatewayUrl:               previous?.gatewayUrl ?? null,
      bannerMessage:            previous?.bannerMessage ?? null,
      maxOvercollectionPercent: previous?.maxOvercollectionPercent ?? 150,
      lastUpdatedBy:            req.session.userId,
      razorpayEnabled: parsed.data.razorpayEnabled,
      razorpayKeyId:   keyIdToSave,
      ...(keySecret     !== undefined ? { razorpayKeySecret:     keySecret }     : {}),
      ...(webhookSecret !== undefined ? { razorpayWebhookSecret: webhookSecret } : {}),
      razorpayMode: "live",
    });

    const auditParts: string[] = [];
    if (parsed.data.razorpayEnabled !== (previous?.razorpayEnabled ?? false))
      auditParts.push(`Razorpay ${parsed.data.razorpayEnabled ? "enabled" : "disabled"}`);
    if (keyIdToSave && keyIdToSave !== previous?.razorpayKeyId)
      auditParts.push("Razorpay live Key ID updated");
    if (keySecret     !== undefined) auditParts.push("Razorpay Key Secret updated");
    if (webhookSecret !== undefined) auditParts.push("Razorpay Webhook Secret updated");

    if (auditParts.length)
      await appendAudit(req, schoolId, "settings_change", "razorpay_settings", null, auditParts.join("; "));

    res.json({
      ...updated,
      razorpayMode: "live",
      razorpayKeySecret:     updated.razorpayKeySecret     ? "••••••••" : null,
      razorpayWebhookSecret: updated.razorpayWebhookSecret ? "••••••••" : null,
    });
  });

  // ── Wipe all Razorpay credentials (purge test/live keys completely) ──────────
  app.delete("/api/admin/fees/external-settings/razorpay/credentials", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const previous = await storage.getExternalPaymentSettings(schoolId);

    await storage.upsertExternalPaymentSettings(schoolId, {
      isEnabled:                previous?.isEnabled ?? false,
      gatewayUrl:               previous?.gatewayUrl ?? null,
      bannerMessage:            previous?.bannerMessage ?? null,
      maxOvercollectionPercent: previous?.maxOvercollectionPercent ?? 150,
      lastUpdatedBy:            req.session.userId,
      razorpayEnabled:  false,        // disable while wiping
      razorpayKeyId:    null,
      razorpayKeySecret: null,
      razorpayWebhookSecret: null,
      razorpayMode:     previous?.razorpayMode ?? "test",
    });

    await appendAudit(req, schoolId, "settings_change", "razorpay_settings", null,
      "Razorpay credentials wiped — Key ID, Key Secret, and Webhook Secret removed");

    res.json({ ok: true });
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
  // simulate-pay removed — live production mode only
  app.post("/api/payments/simulate-pay", (_req, res) => {
    res.status(410).json({ message: "Simulated test payments have been removed. Use live Razorpay checkout." });
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
      // ── Pre-flight checks (outside transaction — read-only) ───────────────
      // Resolve ownership and credentials before acquiring the row lock so we
      // fail fast on obvious bad requests without holding any DB lock.
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

      // Scope check: admin can only create orders for their own school's fees.
      // This prevents a rogue admin from binding their Razorpay credentials to
      // another tenant's fee record via the razorpay_order_id fallback.
      if (Number(fee.school_id) !== schoolId)
        return res.status(403).json({ message: "Access denied" });

      const creds = await resolveRazorpayCredentials(schoolId);
      if (!creds || !creds.enabled)
        return res.status(400).json({ message: "Razorpay is not configured for this school" });

      const razorpay = new Razorpay({
        key_id: creds.keyId,
        key_secret: creds.keySecret,
      });

      // Delegate to the exported helper — see acquireRazorpayOrder above.
      const result = await acquireRazorpayOrder(feeRecordId, schoolId, razorpay.orders);

      if (!result.ok) {
        const body: Record<string, string> = { message: result.message };
        if ("code" in result) body.code = result.code;
        return res.status(result.status).json(body);
      }

      res.json({ orderId: result.orderId, amount: result.amount, currency: "INR", keyId: creds.keyId });
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
      const payment = event?.payload?.payment?.entity ?? {};
      let schoolId: number | null = notes.schoolId ? parseInt(notes.schoolId) : null;

      // Fallback: when schoolId is absent from notes, resolve it from the stored
      // razorpay_order_id (written at order-creation time) so we can still locate
      // the correct school credentials and verify the HMAC signature.
      if (!schoolId && payment.order_id) {
        const orderRow = (await db.execute(sql`
          SELECT school_id FROM fee_records
          WHERE razorpay_order_id = ${payment.order_id}
          LIMIT 1
        `)).rows[0] as any;
        if (orderRow) {
          schoolId = Number(orderRow.school_id);
          console.warn(
            `[razorpay webhook] schoolId missing from notes for payment ${payment.id ?? "unknown"} ` +
            `— resolved school #${schoolId} via order_id ${payment.order_id}`
          );
        }
      }

      if (!schoolId) return res.status(400).json({ message: "schoolId missing from payment notes and could not be resolved from order_id" });

      const creds = await resolveRazorpayCredentials(schoolId);
      if (!creds?.webhookSecret)
        return res.status(400).json({ message: "Webhook secret not configured" });

      // Verify HMAC
      const expected = crypto.createHmac("sha256", creds.webhookSecret).update(bodyStr).digest("hex");
      if (!crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex")))
        return res.status(400).json({ message: "Signature mismatch" });

      if (event.event === "payment.captured") {
        // `payment` is already declared in the outer scope above
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

        // Insert payment record — guarded against duplicate delivery (23505)
        const activeSession = await storage.getActiveSession(schoolId);
        try {
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
        } catch (insertErr: any) {
          // Unique-constraint on idempotency_key (PG 23505) = Razorpay re-sent
          // this webhook.  The losing handler may have already overwritten
          // fee_records.receipt_number with its own allocated receipt before the
          // INSERT failed, so restore it to the canonical receipt held by the
          // winning payment_records row before returning 200.
          if (
            insertErr?.code === "23505" &&
            String(insertErr?.constraint ?? insertErr?.message ?? "").includes("idempotency_key")
          ) {
            console.warn(
              "[razorpay webhook] duplicate payment.captured delivery — restoring canonical receipt and returning idempotent 200",
              insertErr?.constraint ?? insertErr?.message,
            );
            try {
              const winnerRows = (
                await db.execute(sql`
                  SELECT receipt_number FROM payment_records
                  WHERE idempotency_key = ${"rzp_" + payment.id}
                  LIMIT 1
                `)
              ).rows;
              const canonicalReceipt = (winnerRows[0] as any)?.receipt_number as string | undefined;
              if (canonicalReceipt) {
                await db.execute(sql`
                  UPDATE fee_records
                  SET receipt_number = ${canonicalReceipt}
                  WHERE id = ${feeRecordId} AND school_id = ${schoolId}
                `);
              }
            } catch (restoreErr) {
              console.error("[razorpay webhook] failed to restore canonical receipt after 23505", restoreErr);
            }
            return res.json({ ok: true, idempotent: true });
          }
          throw insertErr; // non-idempotency error — rethrow to outer catch → 500
        }

        // Audit log — use correct schema columns (actor_id, description, student_id)
        await db.execute(sql`
          INSERT INTO fee_audit_log (school_id, action, entity_type, entity_id, actor_id, student_id, description, created_at)
          VALUES (${schoolId}, 'payment', 'fee_record', ${feeRecordId}, NULL,
            ${Number(feeRec.student_id)},
            ${"Online payment via Razorpay — " + payment.id + " — receipt " + receiptNumber},
            ${now.toISOString()})
        `);

        // Broadcast real-time update → admin dashboard refreshes instantly
        broadcastPaymentUpdate(schoolId, { feeRecordId, receiptNumber });

        console.log(`[razorpay webhook] Paid fee #${feeRecordId} receipt ${receiptNumber}`);

      } else if (event.event === "payment.failed") {
        // Log failed payment attempts — does NOT change the fee status
        // `payment` is already declared in the outer scope above
        let feeRecordId: number | null = notes.feeRecordId ? parseInt(notes.feeRecordId) : null;
        let studentIdResolved: number | null = notes.studentId ? parseInt(notes.studentId) : null;
        const errCode  = payment?.error_code        ?? "UNKNOWN";
        const errDesc  = payment?.error_description ?? "No description";
        let fallbackUsed = false;

        // When notes are incomplete, try to recover fee/student context from
        // the Razorpay order_id stored at order-creation time.
        if ((!feeRecordId || !studentIdResolved) && payment.order_id) {
          const fallback = (await db.execute(sql`
            SELECT id, student_id FROM fee_records
            WHERE school_id = ${schoolId} AND razorpay_order_id = ${payment.order_id}
            LIMIT 1
          `)).rows[0] as any;

          if (fallback) {
            if (!feeRecordId) feeRecordId = Number(fallback.id);
            if (!studentIdResolved) studentIdResolved = Number(fallback.student_id);
            fallbackUsed = true;
            console.warn(
              `[razorpay webhook] payment.failed: notes incomplete for payment ${payment.id ?? "unknown"} ` +
              `— recovered fee #${feeRecordId} / student #${studentIdResolved} via order_id ${payment.order_id}`
            );
          } else {
            console.warn(
              `[razorpay webhook] payment.failed: notes incomplete for payment ${payment.id ?? "unknown"} ` +
              `and fallback by order_id ${payment.order_id} found no match — audit row will have NULL entity_id/student_id`
            );
          }
        } else {
          // Notes were present; log warnings only for genuinely missing fields
          if (!feeRecordId) {
            console.warn(`[razorpay webhook] payment.failed: feeRecordId missing from notes (payment ${payment.id ?? "unknown"}) — audit row will have NULL entity_id`);
          }
          if (!studentIdResolved) {
            console.warn(`[razorpay webhook] payment.failed: studentId missing from notes (payment ${payment.id ?? "unknown"}) — audit row will have NULL student_id`);
          }
        }

        const notesIncomplete = !feeRecordId || !studentIdResolved;
        const now = new Date();
        await db.execute(sql`
          INSERT INTO fee_audit_log (school_id, action, entity_type, entity_id, actor_id, actor_name, student_id, description, created_at)
          VALUES (
            ${schoolId}, 'payment_failed', 'fee_record',
            ${feeRecordId ?? null},
            NULL,
            'Razorpay Webhook',
            ${studentIdResolved},
            ${
              "Razorpay payment failed — " + errCode + ": " + errDesc +
              (payment.id ? " (" + payment.id + ")" : "") +
              (fallbackUsed ? " [context recovered via order_id fallback]" : "") +
              (notesIncomplete && !fallbackUsed ? " [incomplete notes — student/fee could not be identified]" : "")
            },
            ${now.toISOString()}
          )
        `);

        // Clear the order lock so the student can retry immediately.
        // A failed payment is definitively terminal — keeping razorpay_order_id
        // on the fee record would block all future Pay Now attempts for this invoice.
        if (feeRecordId) {
          await db.execute(sql`
            UPDATE fee_records
            SET razorpay_order_id         = NULL,
                razorpay_order_expires_at = NULL
            WHERE id = ${feeRecordId} AND school_id = ${schoolId}
              AND razorpay_order_id = ${payment.order_id ?? null}
          `);
          console.log(`[razorpay webhook] Order lock cleared for fee #${feeRecordId} after payment failure`);
        }

        console.log(`[razorpay webhook] Payment failed for fee #${feeRecordId}: ${errCode} — ${errDesc}`);
      }

      res.json({ ok: true });
    } catch (err: any) {
      console.error("[razorpay webhook]", err);
      res.status(500).json({ message: String(err) });
    }
  });

  // ── Razorpay: Clear failed order lock (client-side) ──────────────────────
  // Called immediately by the student UI when rzp.on("payment.failed") fires.
  // The webhook may arrive seconds later — this ensures the student can retry
  // the same invoice right away without waiting for the webhook round-trip.
  app.post("/api/payments/clear-failed-order", async (req, res) => {
    const studentId  = req.session?.studentId;
    const adminSchId = req.session?.schoolId;
    if (!studentId && !adminSchId) return res.status(403).json({ message: "Authentication required" });

    const { feeRecordId, razorpayOrderId } = req.body ?? {};
    if (!feeRecordId || typeof feeRecordId !== "number")
      return res.status(400).json({ message: "feeRecordId required" });

    // Resolve schoolId — students use session.schoolId via their own session,
    // admins already have it directly.
    let schoolId: number | null = adminSchId ?? null;
    if (!schoolId && studentId) {
      const student = await storage.getStudentById(studentId);
      schoolId = student?.schoolId ?? null;
    }
    if (!schoolId) return res.status(403).json({ message: "School not found" });

    // Only clear the lock when the order ID on record matches what the client
    // reports — prevents a malicious call from wiping an unrelated order.
    const condition = razorpayOrderId
      ? sql`id = ${feeRecordId} AND school_id = ${schoolId} AND razorpay_order_id = ${razorpayOrderId}`
      : sql`id = ${feeRecordId} AND school_id = ${schoolId}`;

    await db.execute(sql`
      UPDATE fee_records
      SET razorpay_order_id         = NULL,
          razorpay_order_expires_at = NULL
      WHERE ${condition}
        AND status IN ('Due', 'Overdue', 'Partial')
    `);

    res.json({ ok: true });
  });

  // ── Razorpay: Client-side Verify ──────────────────────────────────────────
  // Called by the student UI immediately after the Razorpay handler fires.
  // Verifies the HMAC signature client-side and marks the fee Paid without
  // waiting for the webhook — idempotent if the webhook already ran first.
  app.post("/api/payments/verify", async (req, res) => {
    const studentId   = req.session?.studentId;
    const adminSchId  = req.session?.schoolId;
    if (!studentId && !adminSchId) return res.status(403).json({ message: "Authentication required" });

    const { razorpay_payment_id, razorpay_order_id, razorpay_signature, feeRecordId } = req.body;
    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature || !feeRecordId)
      return res.status(400).json({ message: "razorpay_payment_id, razorpay_order_id, razorpay_signature, feeRecordId required" });

    try {
      const feeResult = await db.execute(sql`
        SELECT fr.*, s.school_id FROM fee_records fr
        JOIN students s ON s.id = fr.student_id
        WHERE fr.id = ${feeRecordId}
        LIMIT 1
      `);
      const feeRec = feeResult.rows[0] as any;
      if (!feeRec) return res.status(404).json({ message: "Fee record not found" });

      const schoolId: number = studentId
        ? (await storage.getStudentById(studentId))!.schoolId
        : adminSchId!;

      // Scope check
      if (studentId && Number(feeRec.student_id) !== studentId)
        return res.status(403).json({ message: "Access denied" });

      const creds = await resolveRazorpayCredentials(schoolId);
      if (!creds?.keySecret) return res.status(400).json({ message: "Razorpay not configured" });

      // Verify HMAC: SHA-256 of "order_id|payment_id"
      const body = `${razorpay_order_id}|${razorpay_payment_id}`;
      const expected = crypto.createHmac("sha256", creds.keySecret).update(body).digest("hex");
      if (expected !== razorpay_signature)
        return res.status(400).json({ message: "Signature verification failed" });

      // Already Paid? Idempotent — return success immediately
      if (feeRec.status === "Paid")
        return res.json({ ok: true, idempotent: true, receiptNumber: feeRec.receipt_number });

      // Mark Paid (same logic as webhook)
      const receiptNumber = await storage.nextReceiptNumber(schoolId, "ON");
      const now = new Date();
      await db.execute(sql`
        UPDATE fee_records
        SET status = 'Paid', paid_date = ${now.toISOString()}, receipt_number = ${receiptNumber}
        WHERE id = ${feeRecordId} AND school_id = ${schoolId}
      `);

      const activeSession = await storage.getActiveSession(schoolId);
      await db.insert(paymentRecords).values({
        schoolId,
        sessionId: activeSession?.id ?? null,
        feeRecordId,
        studentId: Number(feeRec.student_id),
        paymentMethod: "Online",
        referenceNumber: razorpay_payment_id,
        receivedDate: now.toISOString().slice(0, 10),
        amount: Number(feeRec.amount),
        cashierNotes: `Razorpay payment ID: ${razorpay_payment_id} (client-verified)`,
        recordedBy: null,
        receiptNumber,
        idempotencyKey: `rzp_${razorpay_payment_id}`,
      } as any);

      await db.execute(sql`
        INSERT INTO fee_audit_log (school_id, action, entity_type, entity_id, actor_id, student_id, description, created_at)
        VALUES (${schoolId}, 'payment', 'fee_record', ${feeRecordId}, NULL,
          ${Number(feeRec.student_id)},
          ${"Online payment via Razorpay — " + razorpay_payment_id + " — receipt " + receiptNumber + " (client-verified)"},
          ${now.toISOString()})
      `);

      broadcastPaymentUpdate(schoolId, { feeRecordId, receiptNumber });
      console.log(`[razorpay verify] Paid fee #${feeRecordId} receipt ${receiptNumber}`);

      res.json({ ok: true, receiptNumber });
    } catch (err: any) {
      // Unique-constraint violation on idempotency_key (PG code 23505) means the
      // webhook inserted its payment_records row between the moment this handler
      // read the fee as "Due" and the moment it tried to insert.
      //
      // By this point our UPDATE fee_records has already committed, stamping the
      // fee with *our* receipt number instead of the webhook's canonical receipt.
      // We must restore fee_records.receipt_number to the value in payment_records
      // so the two tables stay consistent before returning success.
      if (err?.code === "23505" && String(err?.constraint ?? err?.message ?? "").includes("idempotency_key")) {
        try {
          const winnerRows = (await db.execute(sql`
            SELECT receipt_number FROM payment_records
            WHERE idempotency_key = ${"rzp_" + razorpay_payment_id}
            LIMIT 1
          `)).rows;
          const canonicalReceipt = (winnerRows[0] as any)?.receipt_number as string | undefined;
          if (canonicalReceipt) {
            // Restore the fee record to the webhook's canonical receipt number
            await db.execute(sql`
              UPDATE fee_records
              SET receipt_number = ${canonicalReceipt}
              WHERE id = ${feeRecordId}
            `);
            console.log(`[razorpay verify] idempotency conflict — restored canonical receipt ${canonicalReceipt} on fee #${feeRecordId}`);
            return res.json({ ok: true, idempotent: true, receiptNumber: canonicalReceipt });
          }
        } catch (restoreErr) {
          console.error("[razorpay verify] failed to restore canonical receipt after idempotency conflict", restoreErr);
        }
        // Fallback: webhook row vanished between the conflict and our lookup (extremely
        // unlikely), but fee is Paid — still return success
        console.log(`[razorpay verify] idempotency conflict — canonical receipt lookup missed, returning OK`);
        return res.json({ ok: true, idempotent: true });
      }
      console.error("[razorpay verify]", err);
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

    // Student Registry is global and session-independent — use it directly.
    const allActiveStudents = await storage.getStudentsBySchool(schoolId);
    const rosterForTrigger = allActiveStudents
      .filter(s => s.class && s.section)
      .map(s => ({ studentId: s.id, className: s.class!, sectionName: s.section! }));
    const applicableClasses: string[] = (structure as any).applicableClasses ?? [];
    const eligible = applicableClasses.length > 0
      ? rosterForTrigger.filter(e => applicableClasses.includes(e.className))
      : rosterForTrigger;

    const dueDay: number = (structure as any).autoGenDueDay ?? (structure as any).dueDayOfMonth ?? 10;
    const now = new Date();
    const dueDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(Math.min(dueDay, 28)).padStart(2, "0")}`;

    const existingRecords = await storage.getFeeRecordsBySchool(schoolId, { sessionId: activeSession.id });
    // Map: "studentId:feeType:YYYY-MM" → existing record (month-scoped for monthly fees)
    const existingMap = new Map(existingRecords.map((r: any) => [`${r.studentId}:${r.feeType}:${String(r.dueDate).slice(0, 7)}`, r]));

    let created = 0, synced = 0, skipped = 0;
    for (const enrollment of eligible) {
      const key = `${enrollment.studentId}:${structure.feeType}:${dueDate.slice(0, 7)}`;
      const existing = existingMap.get(key);
      if (existing) {
        if (existing.status === "Due" || existing.status === "Overdue") {
          if (existing.amount !== structure.amount) {
            await db.update(feeRecords)
              .set({ amount: structure.amount })
              .where(and(eq(feeRecords.id, existing.id), eq(feeRecords.schoolId, schoolId)));
            synced++;
          } else {
            skipped++;
          }
        } else {
          skipped++;
        }
        continue;
      }
      await storage.createFeeRecord({
        schoolId,
        studentId: enrollment.studentId,
        sessionId: activeSession.id,
        feeType: structure.feeType,
        amount: structure.amount,
        dueDate,
        status: "Due",
        academicYear: activeSession.sessionName,
        notes: null,
      });
      created++;
    }

    // Void out-of-scope Due/Overdue records for students no longer in applicableClasses
    let voided = 0;
    if (applicableClasses.length > 0) {
      const eligibleIds = new Set(eligible.map((e: any) => e.studentId));
      const outOfScopeRecs = existingRecords.filter((r: any) =>
        r.feeType === structure.feeType &&
        (r.status === "Due" || r.status === "Overdue") &&
        !eligibleIds.has(r.studentId)
      );
      if (outOfScopeRecs.length > 0) {
        const outIds = outOfScopeRecs.map((r: any) => r.id);
        await db.delete(feeRecords)
          .where(and(
            eq(feeRecords.schoolId, schoolId),
            sql`id = ANY(${sql.raw(`ARRAY[${outIds.join(",")}]`)})`,
            or(eq(feeRecords.status, "Due"), eq(feeRecords.status, "Overdue"))
          ));
        voided = outOfScopeRecs.length;
      }
    }

    // Stamp last-generated timestamp on the structure
    await db.update(feeStructures)
      .set({ lastInvoicesGeneratedAt: new Date() })
      .where(eq(feeStructures.id, structureId));

    await appendAudit(req, schoolId, "auto_invoice", "fee_structure", structureId,
      `Manual auto-invoice trigger for "${structure.name}" (${structure.feeType}): ${created} created, ${synced} synced, ${skipped} skipped${voided > 0 ? `, ${voided} out-of-scope voided` : ""} — due ${dueDate}`);

    res.json({ created, synced, skipped, voided, dueDate, session: activeSession.sessionName });
  });

  // ── Audit Log ─────────────────────────────────────────────────────────────

  app.get("/api/admin/fees/audit-log", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const limit  = Math.min(parseInt((req.query.limit  as string) || "50", 10), 100);
    const offset = parseInt((req.query.offset as string) || "0", 10);
    const from   = (req.query.from   as string) || null;
    const to     = (req.query.to     as string) || null;
    const action = (req.query.action as string) || null;
    const search = (req.query.search as string) || null;
    const { entries, total } = await storage.getFeeAuditLog(req.session.schoolId!, limit, offset, from, to, action, search);
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
    const invoiceSession = await storage.getAcademicSessionById(sessionId);

    // The Student Registry is global and session-independent — a student's class/section
    // is always current in the registry regardless of how many sessions exist.
    // Invoice generation therefore reads directly from the registry (all active students)
    // rather than the session-enrollment table, ensuring no active student is ever skipped.
    const allActiveStudents = await storage.getStudentsBySchool(schoolId);
    const effectiveRoster = allActiveStudents
      .filter(s => s.class && s.section)
      .map(s => ({ studentId: s.id, className: s.class!, sectionName: s.section! }));

    // Always enforce the structure's own applicableClasses — the frontend cannot override this.
    // If no classes are set on the structure, the fee applies to every active student.
    const applicableClasses: string[] = (structure as any).applicableClasses ?? [];
    const filtered = applicableClasses.length > 0
      ? effectiveRoster.filter(e => applicableClasses.includes(e.className))
      : effectiveRoster;

    const existingRecords = await storage.getFeeRecordsBySchool(schoolId, { sessionId });
    // Map: "studentId:feeType" → existing fee record (for syncing unpaid ones)
    const existingMap = new Map(existingRecords.map(r => [`${r.studentId}:${r.feeType}`, r]));

    let created = 0, synced = 0, skipped = 0;
    for (const enrollment of filtered) {
      const key = `${enrollment.studentId}:${structure.feeType}`;
      const existing = existingMap.get(key);
      if (existing) {
        // Record exists — sync amount + dueDate if still unpaid, skip if already settled
        if (existing.status === "Due" || existing.status === "Overdue") {
          const needsSync = existing.amount !== structure.amount || existing.dueDate !== dueDate;
          if (needsSync) {
            await db.update(feeRecords)
              .set({ amount: structure.amount, dueDate })
              .where(and(eq(feeRecords.id, existing.id), eq(feeRecords.schoolId, schoolId)));
            synced++;
          } else {
            skipped++;
          }
        } else {
          skipped++; // Paid/Partial/Waived — never touch
        }
        continue;
      }
      await storage.createFeeRecord({
        schoolId, studentId: enrollment.studentId, sessionId,
        feeType: structure.feeType, amount: structure.amount, dueDate, status: "Due",
        academicYear: invoiceSession?.sessionName ?? null,
        notes: null,
      });
      created++;
    }

    // Void out-of-scope Due/Overdue records — students who were previously invoiced
    // but are no longer in applicableClasses (e.g. structure classes narrowed after invoice).
    let voided = 0;
    if (applicableClasses.length > 0) {
      const eligibleStudentIds = new Set(filtered.map(e => e.studentId));
      const outOfScopeRecs = existingRecords.filter(r =>
        r.feeType === structure.feeType &&
        (r.status === "Due" || r.status === "Overdue") &&
        !eligibleStudentIds.has(r.studentId)
      );
      if (outOfScopeRecs.length > 0) {
        const outIds = outOfScopeRecs.map(r => r.id);
        await db.delete(feeRecords)
          .where(and(
            eq(feeRecords.schoolId, schoolId),
            sql`id = ANY(${sql.raw(`ARRAY[${outIds.join(",")}]`)})`,
            or(eq(feeRecords.status, "Due"), eq(feeRecords.status, "Overdue"))
          ));
        voided = outOfScopeRecs.length;
      }
    }

    // Stamp last-generated timestamp on the structure
    await db.update(feeStructures)
      .set({ lastInvoicesGeneratedAt: new Date() })
      .where(eq(feeStructures.id, structureId));

    await appendAudit(req, schoolId, "create", "fee_record", null,
      `Generated invoices from "${structure.name}": ${created} created, ${synced} synced to ₹${structure.amount}, ${skipped} unchanged${voided > 0 ? `, ${voided} out-of-scope voided` : ""}`);
    res.json({ created, synced, skipped, voided, total: filtered.length });
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

    // Parse optional fee-name filter (maps to structure name via fee_type)
    const { feeName: feeNameFilter } = req.query as { feeName?: string };

    // Build a joined query: fee_records LEFT JOIN students LEFT JOIN fee_structures LEFT JOIN (aggregated payment_records)
    // One row per fee record; amounts in rupees. Always scoped to the viewed session.
    const rows = await db.execute(sql`
      SELECT
        s.name              AS student_name,
        s.digital_student_id AS student_id,
        s.class             AS class,
        s.section           AS section,
        COALESCE(fs.name, fr.fee_type) AS fee_name,
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
      LEFT JOIN fee_structures fs ON fs.fee_type = fr.fee_type AND fs.school_id = fr.school_id
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
        ${classFilter   ? sql`AND s.class = ${classFilter}`         : sql``}
        ${feeTypeFilter ? sql`AND fr.fee_type = ${feeTypeFilter}`   : sql``}
        ${feeNameFilter ? sql`AND fs.name = ${feeNameFilter}`       : sql``}
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

    // Columns match ledger display order exactly, then extra financial columns appended.
    // Ledger order: Receipt No. | Student | Class | Section | Fee Name | Fee Type | Amount | Due Date | Status | Paid On | Acad. Year | Notes
    const headers = [
      "Receipt No.",
      "Student Name", "Student ID",
      "Class", "Section",
      "Fee Name", "Fee Type",
      "Amount (₹)",
      "Due Date",
      "Status",
      "Paid On",
      "Acad. Year",
      "Notes",
      // Extra financial detail (not in ledger view but useful for accountants)
      "Amount Paid (₹)", "Outstanding (₹)",
      "Payment Method", "Reference No.",
    ];

    const dataRows = (rows.rows as any[]).map(r => [
      esc(r.receipt_number),
      esc(r.student_name),
      esc(r.student_id),
      esc(r.class),
      esc(r.section),
      esc(r.fee_name),
      esc(r.fee_type),
      esc(r.invoice_amount),
      esc(fmtDateLocal(r.due_date)),
      esc(r.status),
      esc(fmtDateLocal(r.paid_date)),
      esc(r.academic_year),
      esc(r.notes),
      esc(r.amount_paid),
      esc(r.outstanding),
      esc(r.payment_method),
      esc(r.last_reference ?? r.reference_number),
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

  // ── Admin: Dunning Counts (aggregated per-fee-record, for ledger badges) ──
  // Returns { feeRecordId: sentCount } map scoped to the active/viewed session.
  // Only counts entries with status = 'sent' so failed attempts are not presented
  // as delivered reminders to the admin.
  app.get("/api/admin/fees/dunning-counts", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const viewSessionId: number | null = (req as any).viewSessionId ?? null;
    const sessionFilter = viewSessionId ?? (await storage.getActiveSession(schoolId))?.id ?? null;

    const result = await db.execute(
      sessionFilter != null
        ? sql`
            SELECT dl.fee_record_id AS "feeRecordId", COUNT(dl.id)::int AS count
            FROM dunning_log dl
            INNER JOIN fee_records fr ON fr.id = dl.fee_record_id
            WHERE dl.school_id = ${schoolId}
              AND dl.status = 'sent'
              AND fr.session_id = ${sessionFilter}
            GROUP BY dl.fee_record_id`
        : sql`
            SELECT dl.fee_record_id AS "feeRecordId", COUNT(dl.id)::int AS count
            FROM dunning_log dl
            WHERE dl.school_id = ${schoolId}
              AND dl.status = 'sent'
            GROUP BY dl.fee_record_id`,
    );
    // Return as a plain object { [feeRecordId]: count }
    const counts: Record<number, number> = {};
    for (const row of result.rows as Array<{ feeRecordId: number; count: number }>) {
      counts[row.feeRecordId] = row.count;
    }
    res.json(counts);
  });

  // ── GET /api/admin/fees/failed-counts ────────────────────────────────────
  // Returns { [feeRecordId]: { count, lastError } } for payment_failed entries
  app.get("/api/admin/fees/failed-counts", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const viewSessionId: number | null = (req as any).viewSessionId ?? null;
    const sessionFilter = viewSessionId ?? (await storage.getActiveSession(schoolId))?.id ?? null;

    const result = await db.execute(
      sessionFilter != null
        ? sql`
            SELECT
              al.entity_id::int            AS "feeRecordId",
              COUNT(al.id)::int            AS count,
              (ARRAY_AGG(al.description ORDER BY al.created_at DESC))[1] AS "lastError"
            FROM fee_audit_log al
            INNER JOIN fee_records fr ON fr.id = al.entity_id::int
            WHERE al.school_id   = ${schoolId}
              AND al.action      = 'payment_failed'
              AND al.entity_type = 'fee_record'
              AND al.entity_id   IS NOT NULL
              AND fr.session_id  = ${sessionFilter}
              AND fr.status      NOT IN ('Paid', 'Waived')
            GROUP BY al.entity_id`
        : sql`
            SELECT
              al.entity_id::int            AS "feeRecordId",
              COUNT(al.id)::int            AS count,
              (ARRAY_AGG(al.description ORDER BY al.created_at DESC))[1] AS "lastError"
            FROM fee_audit_log al
            INNER JOIN fee_records fr ON fr.id = al.entity_id::int
            WHERE al.school_id   = ${schoolId}
              AND al.action      = 'payment_failed'
              AND al.entity_type = 'fee_record'
              AND al.entity_id   IS NOT NULL
              AND fr.status      NOT IN ('Paid', 'Waived')
            GROUP BY al.entity_id`,
    );

    const counts: Record<number, { count: number; lastError: string | null }> = {};
    for (const row of result.rows as Array<{ feeRecordId: number; count: number; lastError: string | null }>) {
      counts[row.feeRecordId] = { count: row.count, lastError: row.lastError ?? null };
    }
    res.json(counts);
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
            -- Use LEFT JOIN so orphaned dunning_log rows (fee record deleted but
            -- cascade somehow missed) are still visible to the admin rather than
            -- being silently dropped.  We filter by student via a sub-select on
            -- fee_records so we don't need the FK to be intact.
            SELECT dl.id, dl.fee_record_id, dl.channel, dl.stage, dl.sent_at, dl.status,
                   dl.error_message, dl.recipient, dl.student_name,
                   (fr.id IS NULL) AS fee_record_deleted
            FROM dunning_log dl
            LEFT JOIN fee_records fr ON fr.id = dl.fee_record_id
            WHERE dl.school_id = ${schoolId}
              AND dl.fee_record_id IN (
                SELECT id FROM fee_records WHERE student_id = ${studentId}
              )
            ORDER BY dl.sent_at DESC
            LIMIT 200`
        : sql`
            SELECT dl.id, dl.fee_record_id, dl.channel, dl.stage, dl.sent_at, dl.status,
                   dl.error_message, dl.recipient, dl.student_name,
                   (fr.id IS NULL) AS fee_record_deleted
            FROM dunning_log dl
            LEFT JOIN fee_records fr ON fr.id = dl.fee_record_id
            WHERE dl.school_id = ${schoolId}
            ORDER BY dl.sent_at DESC
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

  // ── Admin: Dunning Job Status ─────────────────────────────────────────────
  app.get("/api/admin/fees/dunning-job-status", async (req, res) => {
    if (!adminGuard(req, res)) return;
    try {
      const rows = await db.select().from(dunningJobStatus).where(eq(dunningJobStatus.id, 1)).limit(1);
      if (rows.length === 0) {
        return res.json({ isRunning: false, startedAt: null, lastCompletedAt: null });
      }
      return res.json(rows[0]);
    } catch (err) {
      return res.status(500).json({ message: String(err) });
    }
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

  // ── GET /api/fees/analytics/aging-students ───────────────────────────────
  // Returns student-level detail for a specific AR aging bucket.
  // Query params: bucket = "1-30" | "31-60" | "61-90" | "90+"
  app.get("/api/fees/analytics/aging-students", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const bucket = req.query.bucket as string;

    const allowed = ["1-30", "31-60", "61-90", "90+"];
    if (!bucket || !allowed.includes(bucket)) {
      return res.status(400).json({ message: "bucket must be one of: 1-30, 31-60, 61-90, 90+" });
    }

    const viewSessionId: number | null = (req as any).viewSessionId ?? null;
    const sessionId = viewSessionId ?? (await storage.getActiveSession(schoolId))?.id ?? null;
    const sfFR = sessionId ? sql` AND fr.session_id = ${sessionId}` : sql``;

    let bucketCondition: ReturnType<typeof sql>;
    if (bucket === "1-30")  bucketCondition = sql`CURRENT_DATE - fr.due_date::date BETWEEN 1 AND 30`;
    else if (bucket === "31-60") bucketCondition = sql`CURRENT_DATE - fr.due_date::date BETWEEN 31 AND 60`;
    else if (bucket === "61-90") bucketCondition = sql`CURRENT_DATE - fr.due_date::date BETWEEN 61 AND 90`;
    else                         bucketCondition = sql`CURRENT_DATE - fr.due_date::date > 90`;

    try {
      const result = await db.execute(sql`
        SELECT
          fr.id                                                                          AS fee_record_id,
          fr.student_id,
          s.name                                                                         AS student_name,
          s.class,
          s.section,
          fr.fee_type,
          fr.due_date,
          GREATEST(fr.amount + fr.late_fee_amount - COALESCE(p.paid, 0), 0)::int        AS amount,
          (CURRENT_DATE - fr.due_date::date)::int                                       AS days_overdue
        FROM fee_records fr
        JOIN students s ON s.id = fr.student_id
        LEFT JOIN (
          SELECT fee_record_id, SUM(amount)::int AS paid
          FROM payment_records
          WHERE school_id = ${schoolId} AND fee_record_id IS NOT NULL
          GROUP BY fee_record_id
        ) p ON p.fee_record_id = fr.id
        WHERE fr.school_id = ${schoolId}
          AND fr.status IN ('Due', 'Overdue', 'Partial')
          AND fr.due_date IS NOT NULL
          AND ${bucketCondition}
          ${sfFR}
        ORDER BY amount DESC
        LIMIT 200
      `);
      res.json(result.rows);
    } catch (err: any) {
      console.error("[fees/aging-students]", err);
      res.status(500).json({ message: String(err) });
    }
  });

  // ── POST /api/admin/fees/dunning-trigger ─────────────────────────────────
  // Fires a dunning reminder for a single fee record (all enabled channels).
  app.post("/api/admin/fees/dunning-trigger", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const { feeRecordId } = req.body as { feeRecordId: number };
    if (!feeRecordId || isNaN(Number(feeRecordId))) {
      return res.status(400).json({ message: "feeRecordId is required" });
    }

    try {
      const { runDunningForSingleFee } = await import("./dunning");
      const result = await runDunningForSingleFee(schoolId, Number(feeRecordId));
      res.json(result);
    } catch (err: any) {
      console.error("[fees/dunning-trigger]", err);
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

  // ── Report Email Schedule ─────────────────────────────────────────────────

  app.get("/api/admin/fees/report-schedule", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const schedule = await storage.getReportEmailSchedule(schoolId);
    res.json(schedule ?? { enabled: false, recipients: [], lastSentAt: null });
  });

  const reportScheduleSchema = z.object({
    enabled:    z.boolean().optional(),
    recipients: z.array(z.string().email()).max(20).optional(),
  });

  app.patch("/api/admin/fees/report-schedule", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const parsed = reportScheduleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    const schoolId = req.session.schoolId!;
    await storage.upsertReportEmailSchedule(schoolId, {
      enabled:    parsed.data.enabled,
      recipients: parsed.data.recipients,
    });
    const auditParts: string[] = [];
    if (parsed.data.enabled !== undefined) auditParts.push(`enabled: ${parsed.data.enabled}`);
    if (parsed.data.recipients !== undefined) auditParts.push(`recipients: ${parsed.data.recipients.join(", ")}`);
    await appendAudit(req, schoolId, "settings_change", "report_schedule", null,
      `Report schedule updated — ${auditParts.join(", ") || "(no changes)"}`);
    res.json({ ok: true });
  });

  app.post("/api/admin/fees/report-schedule/send-now", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    try {
      const { sendAnalyticsReport } = await import("./analytics-report");
      // forceEnabled=true: sends regardless of whether the schedule is enabled,
      // so admins can test delivery without having to toggle the schedule on.
      const result = await sendAnalyticsReport(schoolId, { forceEnabled: true });
      if (result.errors.length > 0 && result.sent === 0) {
        return res.status(400).json({ message: result.errors.join("; ") });
      }
      await appendAudit(req, schoolId, "settings_change", "report_schedule", null,
        `Manual analytics report send: ${result.sent} sent, ${result.errors.length} error(s)`);
      res.json({ sent: result.sent, errors: result.errors });
    } catch (err: any) {
      res.status(500).json({ message: String(err.message ?? err) });
    }
  });

  // ── Student: External Portal Info ─────────────────────────────────────────
  app.get("/api/student/fees/portal-info", async (req, res) => {
    if (!req.session?.studentId) return res.status(403).json({ message: "Student access required" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(403).json({ message: "Student not found" });
    const settings = await storage.getExternalPaymentSettings(student.schoolId);
    // Resolve credentials with env-var fallback so the Pay Now button appears
    // even when only process.env.RAZORPAY_* vars are set (no DB config saved yet).
    const creds = await resolveRazorpayCredentials(student.schoolId);
    const razorpayEnabled = creds?.enabled ?? false;
    res.json({
      isEnabled: settings?.isEnabled ?? false,
      gatewayUrl: settings?.gatewayUrl ?? null,
      bannerMessage: settings?.bannerMessage ?? null,
      razorpayEnabled,
      razorpayKeyId: razorpayEnabled ? (creds?.keyId ?? null) : null,
    });
  });
}
