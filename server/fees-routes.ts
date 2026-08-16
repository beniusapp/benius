import type { Express } from "express";
import { storage } from "./storage";
import { db } from "./db";
import { calculateLateFee, recalculateLateFees, DEFAULT_LATE_FEE_CONFIG, type LateFeeConfig } from "./late-fee-engine";
import { buildBreakdownSnapshot, warnOnSumMismatch } from "./invoice-snapshot";
import { users, schools, students, feeRecords, paymentRecords, notificationConfig, dunningLog, dunningTemplates, externalPaymentSettings, feeStructures, dunningJobStatus } from "@shared/schema";
import { and, eq, sql, desc, or } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import Razorpay from "razorpay";
import { broadcastPaymentUpdate } from "./sse";
import { fetchRazorpayData, mapRazorpayPayment, upsertPaymentAttempt, updatePaymentAttemptRefund } from "./rzp-enrichment";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import sharp from "sharp";

// ── Signature background removal ─────────────────────────────────────────────
// Converts white/light-grey background to transparency.
// Returns true on success, false if removal failed (caller uses original as fallback).
async function removeSignatureBackground(inputPath: string, outputPath: string): Promise<boolean> {
  try {
    const { data, info } = await sharp(inputPath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Pixels where ALL channels >= HARD → fully transparent (white/near-white background).
    // Pixels in SOFT..HARD zone → proportionally faded (soft edge).
    // All other pixels (ink) stay fully opaque.
    const HARD = 215; // near-white threshold
    const SOFT = 160; // soft-edge lower boundary

    for (let i = 0; i < data.length; i += 4) {
      const minCh = Math.min(data[i]!, data[i + 1]!, data[i + 2]!);
      if (minCh >= HARD) {
        data[i + 3] = 0; // fully transparent
      } else if (minCh >= SOFT) {
        // Linear fade: opaque at SOFT, transparent at HARD
        data[i + 3] = Math.round(((HARD - minCh) / (HARD - SOFT)) * 255);
      }
      // else: keep existing alpha (fully opaque dark ink)
    }

    await sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .trim({ threshold: 10 })
      .png({ compressionLevel: 7 })
      .toFile(outputPath);

    return true;
  } catch (err) {
    console.error("[sig-bg-remove] Failed:", err);
    return false;
  }
}

// ── Fee receipt signature uploader — 2 MB, images only, staged to temp ──────
const feeReceiptSigUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(process.cwd(), "uploads");
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const unique = Date.now() + "-" + Math.round(Math.random() * 1e6);
      cb(null, unique + path.extname(file.originalname));
    },
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only PNG, JPG, or WebP images are allowed"));
  },
});

// ── Exported for integration testing ─────────────────────────────────────────
// acquireRazorpayOrder contains the atomic lock → check → create → persist
// sequence that the /api/payments/create-order route handler delegates to.
// Extracting it lets tests call the function directly with a mocked Razorpay
// instance without standing up a full HTTP server.
export type AcquireOrderResult =
  | { ok: true;  orderId: string; amount: number; lateFeeAmount: number }
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
    // Load fee structures inside the transaction so a single DB connection
    // is used for the whole acquire sequence.  A plain SELECT acquires no row
    // locks and completes in milliseconds — lock-duration impact is negligible.
    const schoolStructures = await tx
      .select({ feeType: feeStructures.feeType, lateFeeConfig: feeStructures.lateFeeConfig })
      .from(feeStructures)
      .where(eq(feeStructures.schoolId, schoolId));
    const lateFeeConfigMap = new Map<string, LateFeeConfig>();
    for (const s of schoolStructures) {
      const cfg = s.lateFeeConfig as LateFeeConfig | null;
      if (cfg?.enabled) lateFeeConfigMap.set(s.feeType.trim().toLowerCase(), cfg);
    }

    // Row-level write lock — concurrent requests for this fee block here.
    const lockedResult = await tx.execute(sql`
      SELECT id, status, amount, late_fee_amount, due_date, fee_type,
             razorpay_order_id, razorpay_order_expires_at
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
        // Safety rule: an "attempted" order ALWAYS blocks creation of a new order,
        // regardless of whether the local checkout window has elapsed.
        //
        // Reason: Razorpay can capture a payment and deliver the webhook seconds
        // to minutes after the client modal closes — well after the application-
        // side checkout deadline.  The local deadline expiring is NOT proof that
        // the payment failed.  Allowing a new order while the old one is still
        // in "attempted" state risks a duplicate charge (both orders captured).
        //
        // Recovery path: once Razorpay transitions the order to a terminal state
        // ("expired" or "paid") the webhook clears razorpay_order_id and the
        // student can retry normally.  The student sees a clear status message
        // in the meantime.
        result = {
          ok: false, status: 409, code: "PAYMENT_IN_PROGRESS",
          message: "A payment was already submitted for this fee. If it was successful, the status will update automatically — please check back in a few minutes.",
        };
        return;
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
    //
    // Compute the authoritative late fee at this exact moment — not the nightly-cached
    // late_fee_amount stored on the row.  This guarantees the Razorpay order amount
    // equals exactly what the student portal displays right now.
    const lateFeeConfig = lateFeeConfigMap.get(
      ((locked.fee_type as string) ?? "").trim().toLowerCase(),
    ) ?? DEFAULT_LATE_FEE_CONFIG;
    const currentLateFee = calculateLateFee(
      lateFeeConfig,
      (locked.due_date as string) ?? "",
      locked.status as string,
    );
    const amountPaise = Math.round((Number(locked.amount) + currentLateFee) * 100);
    const order = await rzpOrders.create({
      amount: amountPaise,
      currency: "INR",
      receipt: `fee_${feeRecordId}`,
      notes: {
        feeRecordId:   String(feeRecordId),
        schoolId:      String(schoolId),
        lateFeeAmount: String(currentLateFee), // immutable snapshot — read back by the webhook
      },
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

    result = { ok: true, orderId: order.id, amount: amountPaise, lateFeeAmount: currentLateFee };
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
    dueDayOfMonth: z.number().int().min(1).max(31).optional().nullable(),
    breakdown: z.array(breakdownItemSchema).default([]),
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
    // Invoice-first: feeRecordId must reference an existing invoice.
    // Required for normal payments; optional only when autoFifo=true (server auto-resolves invoices).
    feeRecordId: z.number().int().positive().optional().nullable(),
    studentId: z.number().int().positive(),
    // FIFO mode: when true and feeRecordId is null, funds are auto-allocated to the
    // student's unpaid invoices oldest-first (due_date ASC).
    autoFifo: z.boolean().default(false),
    // feeNotes: optional notes written to the linked invoice during payment
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

  // ── Unpaid Invoices for a Student (invoice-picker endpoint) ─────────────────
  // Returns Due/Overdue fee_records for the specified student, with accrued late fee.
  // Used by the "Record Offline Payment" modal to let the admin select which
  // invoices they are collecting cash/cheque for.
  app.get("/api/admin/fees/students/:studentId/unpaid-invoices", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId  = req.session.schoolId!;
    const studentId = parseInt(req.params.studentId);
    if (!studentId || isNaN(studentId)) return res.status(400).json({ message: "Invalid studentId" });

    // Tenant guard: student must belong to this school
    const [studentRow] = await db.select({ id: students.id })
      .from(students)
      .where(and(eq(students.id, studentId), eq(students.schoolId, schoolId)));
    if (!studentRow) return res.status(404).json({ message: "Student not found" });

    const rows = await db.execute(sql`
      SELECT
        fr.id,
        fr.student_id       AS "studentId",
        fr.fee_type         AS "feeType",
        fr.amount,
        fr.due_date         AS "dueDate",
        fr.status,
        fr.invoice_number   AS "invoiceNumber",
        fr.fee_period_start AS "feePeriodStart",
        fr.fee_period_end   AS "feePeriodEnd",
        fr.late_fee_amount  AS "lateFeeAmount",
        fr.academic_year    AS "academicYear"
      FROM fee_records fr
      WHERE fr.student_id = ${studentId}
        AND fr.school_id  = ${schoolId}
        AND fr.status IN ('Due', 'Overdue')
      ORDER BY fr.due_date ASC, fr.id ASC
    `);

    // Compute accrued late fee for each invoice using the live late-fee engine
    const allStructures = await storage.getFeeStructuresBySchool(schoolId);
    const lateFeeMap    = new Map<string, LateFeeConfig>();
    for (const s of allStructures) {
      const cfg = s.lateFeeConfig as LateFeeConfig | undefined;
      if (cfg?.enabled) lateFeeMap.set(s.feeType.trim().toLowerCase(), cfg);
    }
    const today = new Date().toISOString().slice(0, 10);

    const invoices = (rows.rows as any[]).map(r => {
      const cfg     = lateFeeMap.get((r.feeType ?? "").trim().toLowerCase());
      const accrued = cfg ? calculateLateFee(cfg, r.dueDate ?? "", r.status, today) : 0;
      return { ...r, accruedLateFee: accrued, totalDue: Number(r.amount) + accrued };
    });

    res.json(invoices);
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
          fr.late_fee_amount,
          fr.due_date,
          fr.session_id,
          COALESCE(p.total_paid, 0)::int AS amount_paid,
          GREATEST(fr.amount + fr.late_fee_amount - COALESCE(p.total_paid, 0), 0)::int AS balance
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
        HAVING GREATEST(fr.amount + fr.late_fee_amount - COALESCE(p.total_paid, 0), 0) > 0
        ORDER BY fr.due_date ASC, fr.id ASC
      `);

      const invoices = unpaidRows.rows as Array<{
        id: number; amount: number; late_fee_amount: number; due_date: string;
        session_id: number | null; amount_paid: number; balance: number;
      }>;

      if (invoices.length === 0) {
        return res.status(400).json({ message: "No unpaid invoices found for this student to allocate against." });
      }

      // Build allocation plan (oldest-first).
      // One-invoice = one-payment rule: only include an invoice when the remaining
      // balance can cover its full outstanding amount.  Invoices that cannot be
      // fully paid in this sweep are skipped — no Partial status is ever created.
      let remaining = paymentData.amount;
      const plan: Array<{ invoiceId: number; allocation: number; sessionId: number | null; lateFeeAmount: number }> = [];
      for (const inv of invoices) {
        if (remaining <= 0) break;
        const balance = Number(inv.balance);
        if (remaining < balance) continue; // cannot fully pay this invoice — skip
        const allocation = balance; // always the full outstanding balance (base + late fee)
        plan.push({ invoiceId: inv.id, allocation, sessionId: inv.session_id, lateFeeAmount: Number(inv.late_fee_amount ?? 0) });
        remaining -= allocation;
      }

      // Execute the plan atomically
      const results: Array<{ feeRecordId: number; amount: number; receiptNumber: string; newStatus: string }> = [];

      await db.transaction(async (tx) => {
        for (const step of plan) {
          const opReceipt = await storage.nextReceiptNumber(schoolId, "OF");

          // Acquire row-level lock to prevent concurrent over-payment
          const lockedRow = await tx.execute(sql`
            SELECT status, amount, late_fee_amount FROM fee_records
            WHERE id = ${step.invoiceId} AND school_id = ${schoolId}
            FOR UPDATE
          `);
          const invoiceAmount = Number((lockedRow.rows[0] as any)?.amount) || 0;
          const invoiceLateFee = Number((lockedRow.rows[0] as any)?.late_fee_amount) || 0;

          // Sum already-paid (including any sibling steps in this same tx that committed before)
          const paidSoFar = await tx.execute(sql`
            SELECT COALESCE(SUM(amount), 0)::int AS total_paid
            FROM payment_records
            WHERE fee_record_id = ${step.invoiceId}
          `);
          const alreadyPaid = Number((paidSoFar.rows[0] as any)?.total_paid) || 0;

          // One-invoice = one-payment rule: skip if already Paid under lock.
          const fifoLockedStatus = (lockedRow.rows[0] as any)?.status as string | undefined;
          if (fifoLockedStatus === "Paid") continue;

          // Reject if this invoice cannot be fully paid — no Partial status allowed.
          const balance = Math.max(0, invoiceAmount + invoiceLateFee - alreadyPaid);
          if (balance <= 0 || step.allocation < balance) continue;
          const safeAllocation = balance; // always exact full payment (base + late fee)

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
              ${req.session.userId ?? null}, ${opReceipt}, ${step.lateFeeAmount}
            )
          `);

          const newStatus = "Paid"; // one-invoice = one-payment: Partial rejected above
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

    // ── Invoice-first enforcement ─────────────────────────────────────────────
    // Offline payments must always be linked to an existing invoice (fee_record).
    // The standalone "create invoice + payment in one step" path has been removed.
    // Use "Add Invoice" to create a Due invoice first, then record payment here.
    if (!paymentData.feeRecordId && !paymentData.autoFifo) {
      return res.status(400).json({
        message: "feeRecordId is required. Record Offline Payment must be linked to an existing invoice. Use 'Add Invoice' to create a Due invoice first.",
      });
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
    const opReceipt = await storage.nextReceiptNumber(schoolId, "OF");

    // Destructure out fee-record-only fields before passing to createPaymentRecord
    const { feeNotes: _fn, ...paymentOnly } = paymentData;

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

    // Closure variable — computed inside the FOR UPDATE transaction, read by the INSERT.
    let lateFeeForOfflineInsert = 0;

    await db.transaction(async (tx) => {
      if (paymentOnly.feeRecordId) {
        // Load fee structures inside the transaction to reuse a single DB connection.
        const offlineStructures = await tx
          .select({ feeType: feeStructures.feeType, lateFeeConfig: feeStructures.lateFeeConfig })
          .from(feeStructures)
          .where(eq(feeStructures.schoolId, schoolId));
        const offlineLateFeeMap = new Map<string, LateFeeConfig>();
        for (const s of offlineStructures) {
          const cfg = s.lateFeeConfig as LateFeeConfig | null;
          if (cfg?.enabled) offlineLateFeeMap.set(s.feeType.trim().toLowerCase(), cfg);
        }

        // Acquire a row-level write lock — concurrent requests will queue here.
        const lockResult = await tx.execute(
          sql`SELECT status, amount, due_date, fee_type FROM fee_records
              WHERE id = ${paymentOnly.feeRecordId} AND school_id = ${schoolId}
              FOR UPDATE`,
        );
        const lockedFee = lockResult.rows[0] as {
          status: string; amount: number; due_date: string; fee_type: string;
        } | undefined;

        if (lockedFee) {
          // ── One-invoice = one-payment rule (primary guards, run under lock) ──────

          // Guard 1: invoice already Paid — no second payment, ever.
          if (lockedFee.status === "Paid") {
            overpaymentBlock = {
              message: "This invoice has already been paid in full. No additional payments can be recorded against it.",
              invoiceAmount: Number(lockedFee.amount),
              totalAlreadyPaid: Number(lockedFee.amount),
              newAmount: paymentOnly.amount,
            };
            return;
          }

          // Compute the current late fee using the live moment — same function used by the
          // student portal and Razorpay order creation, so all three surfaces agree.
          const offlineLFConfig = offlineLateFeeMap.get(
            (lockedFee.fee_type ?? "").trim().toLowerCase(),
          ) ?? DEFAULT_LATE_FEE_CONFIG;
          const offlineLateFee = calculateLateFee(
            offlineLFConfig, lockedFee.due_date ?? "", lockedFee.status,
          );
          const expectedTotal = Number(lockedFee.amount) + offlineLateFee;
          lateFeeForOfflineInsert = offlineLateFee; // capture for the INSERT below

          // Guard 2: payment must equal base + applicable late fee (no partial payments).
          if (paymentOnly.amount !== expectedTotal) {
            overpaymentBlock = {
              message: offlineLateFee > 0
                ? `Payment amount (₹${paymentOnly.amount.toLocaleString("en-IN")}) must equal the full invoice amount including late fee (₹${expectedTotal.toLocaleString("en-IN")} = ₹${Number(lockedFee.amount).toLocaleString("en-IN")} base + ₹${offlineLateFee.toLocaleString("en-IN")} late fee). Partial payments are not accepted.`
                : `Payment amount (₹${paymentOnly.amount.toLocaleString("en-IN")}) must equal the full invoice amount (₹${Number(lockedFee.amount).toLocaleString("en-IN")}). Partial payments are not accepted.`,
              invoiceAmount: expectedTotal,
              totalAlreadyPaid: 0,
              newAmount: paymentOnly.amount,
            };
            return;
          }

          // ── Safety cap — secondary guard for any accumulated prior payments ───────
          const sumResult = await tx.execute(
            sql`SELECT COALESCE(SUM(amount), 0)::int AS existing_paid
                FROM payment_records
                WHERE fee_record_id = ${paymentOnly.feeRecordId}`,
          );
          const totalAlreadyPaid = Number((sumResult.rows[0] as any)?.existing_paid) || 0;
          const cap = Math.round(expectedTotal * OVERPAYMENT_FACTOR);

          if (totalAlreadyPaid + paymentOnly.amount > cap) {
            overpaymentBlock = {
              message: `This payment (₹${paymentOnly.amount.toLocaleString("en-IN")}) would bring the total collected to ₹${(totalAlreadyPaid + paymentOnly.amount).toLocaleString("en-IN")}, which exceeds the invoice amount (₹${Number(lockedFee.amount).toLocaleString("en-IN")}).`,
              invoiceAmount: Number(lockedFee.amount),
              totalAlreadyPaid,
              newAmount: paymentOnly.amount,
            };
            return;
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
              ${paymentOnly.feeRecordId != null ? lateFeeForOfflineInsert : (paymentData.lateFeePaid ?? 0)}
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
          const newStatus = "Paid"; // one-invoice = one-payment: partial amount blocked above
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

    // Include fee receipt signature URLs (tenant-scoped via schoolMetadata)
    const sigMeta = await storage.getSchoolMetadataRaw(schoolId, "fee_receipt_signature") as any;
    // Best-display URL: processed (transparent) > original > legacy fileUrl
    const feeReceiptSignatureUrl =
      sigMeta?.processedSignatureUrl ??
      sigMeta?.originalSignatureUrl  ??
      sigMeta?.fileUrl               ?? null;

    res.json({
      ...base,
      razorpayMode: "live",
      razorpayEnabled:             creds?.enabled ?? false,
      razorpayKeyId:               effectiveKeyId,
      razorpayKeySecret:           creds ? "••••••••" : null,
      razorpayWebhookSecret:       creds?.webhookSecret ? "••••••••" : null,
      feeReceiptSignatureUrl,
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

    // Validate: Key ID must be present (new or existing)
    const effectiveKeyId = keyIdToSave ?? previous?.razorpayKeyId ?? null;
    if (parsed.data.razorpayEnabled && !effectiveKeyId) {
      return res.status(400).json({ message: "Key ID is required before enabling Razorpay." });
    }

    // Validate: Webhook Secret is always mandatory
    const effectiveWebhookSecret = webhookSecret !== undefined ? webhookSecret : previous?.razorpayWebhookSecret ?? null;
    if (!effectiveWebhookSecret) {
      return res.status(400).json({ message: "Webhook Secret is required. Copy it from Razorpay Dashboard → Webhooks → your webhook → Secret." });
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

  // ── Fee Receipt Signature — Upload ───────────────────────────────────────
  // schoolId is always from the authenticated session — never from client body.
  // ── Fee Receipt Signature — Upload ───────────────────────────────────────
  // Auth middleware runs first (before multer touches the body).
  // On success calls next(); on failure sends 401/403 and stops.
  const sigAuthMiddleware = (req: any, res: any, next: any) => {
    if (!adminGuard(req, res)) return;
    next();
  };

  // Multer middleware with inline error handling — passes control to next handler on success.
  const sigMulterMiddleware = (req: any, res: any, next: any) => {
    feeReceiptSigUpload.single("file")(req, res, (err: any) => {
      if (err && err.code === "LIMIT_FILE_SIZE")
        return res.status(400).json({ message: "File too large. Maximum size is 2 MB." });
      if (err)
        return res.status(400).json({ message: err.message || "Upload error" });
      next();
    });
  };

  app.post("/api/admin/fees/external-portal/signature",
    sigAuthMiddleware,
    sigMulterMiddleware,
    async (req: any, res: any) => {
      if (!req.file) {
        return res.status(400).json({ success: false, error: "No file uploaded" });
      }

      // Double-check MIME + extension server-side
      const ALLOWED_MIME = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
      const ALLOWED_EXT  = [".jpg", ".jpeg", ".png", ".webp"];
      const fileMime = req.file.mimetype?.toLowerCase() ?? "";
      const fileExt  = path.extname(req.file.originalname).toLowerCase();
      if (!ALLOWED_MIME.includes(fileMime) || !ALLOWED_EXT.includes(fileExt)) {
        try { fs.unlinkSync(req.file.path); } catch { /* best-effort */ }
        return res.status(400).json({ success: false, error: "Only PNG, JPG, or WebP images are allowed" });
      }

      const schoolId    = req.session.schoolId as number;
      const ts          = Date.now();
      const sigDir      = path.join(process.cwd(), "uploads", "schools", String(schoolId), "receipt-signature");
      try { fs.mkdirSync(sigDir, { recursive: true }); } catch { /* already exists */ }

      // ── Remove old files ────────────────────────────────────────────────────
      try {
        const prev = await storage.getSchoolMetadataRaw(schoolId, "fee_receipt_signature") as any;
        for (const key of ["originalSignatureUrl", "processedSignatureUrl", "fileUrl"]) {
          if (prev?.[key]) {
            try { fs.unlinkSync(path.join(process.cwd(), prev[key])); } catch { /* best-effort */ }
          }
        }
      } catch { /* best-effort cleanup */ }

      // ── Move temp → permanent file (stored as-is — no processing) ────────────
      const sigFilename = `sig-${ts}${fileExt}`;
      const sigPath     = path.join(sigDir, sigFilename);
      try {
        fs.renameSync(req.file.path, sigPath);
      } catch {
        try { fs.unlinkSync(req.file.path); } catch { /* best-effort */ }
        return res.status(500).json({ success: false, error: "Failed to save signature file" });
      }
      const signatureUrl = `/uploads/schools/${schoolId}/receipt-signature/${sigFilename}`;

      // ── Persist metadata ────────────────────────────────────────────────────
      try {
        await storage.setSchoolMetadataRaw(schoolId, "fee_receipt_signature", {
          originalSignatureUrl:  signatureUrl,
          processedSignatureUrl: signatureUrl, // same — no server-side processing
          fileName:   req.file.originalname,
          mimeType:   fileMime,
          fileSize:   req.file.size,
          uploadedAt: new Date().toISOString(),
          updatedAt:  new Date().toISOString(),
          updatedBy:  req.session.userId,
        });
      } catch {
        return res.status(500).json({ success: false, error: "Failed to save signature metadata" });
      }

      res.set("Cache-Control", "no-store");
      return res.json({
        success: true,
        feeReceiptSignatureUrl: signatureUrl,
      });
    },
  );

  // ── Fee Receipt Signature — Remove ────────────────────────────────────────
  app.delete("/api/admin/fees/external-portal/signature", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId as number;

    try {
      const existing = await storage.getSchoolMetadataRaw(schoolId, "fee_receipt_signature") as any;
      // Delete all stored files (original + processed + legacy fileUrl)
      for (const key of ["originalSignatureUrl", "processedSignatureUrl", "fileUrl"]) {
        if (existing?.[key]) {
          try { fs.unlinkSync(path.join(process.cwd(), existing[key])); } catch { /* best-effort */ }
        }
      }
    } catch { /* best-effort */ }

    await storage.setSchoolMetadataRaw(schoolId, "fee_receipt_signature", null);
    res.set("Cache-Control", "no-store");
    res.json({ success: true, message: "Fee receipt signature removed" });
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
      const sigBuf = Buffer.from(sig, "hex");
      const expBuf = Buffer.from(expected, "hex");
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf))
        return res.status(400).json({ message: "Signature mismatch" });

      if (event.event === "payment.captured") {
        // `payment` is already declared in the outer scope above
        const feeRecordId = notes.feeRecordId ? parseInt(notes.feeRecordId) : null;
        if (!feeRecordId) return res.status(400).json({ message: "feeRecordId missing from notes" });

        // The late fee snapshot embedded in the order notes at creation time — immutable.
        // This is the exact late fee the student was shown and Razorpay charged.
        const lateFeeFromNotes = Math.round(Number(notes.lateFeeAmount ?? 0)) || 0;

        // Load the fee record
        const feeRec = (await db.execute(sql`SELECT * FROM fee_records WHERE id = ${feeRecordId} AND school_id = ${schoolId} LIMIT 1`)).rows[0] as any;
        if (!feeRec) return res.status(404).json({ message: "Fee record not found" });

        // Already paid? idempotent — 200 OK
        if (feeRec.status === "Paid") return res.json({ ok: true, idempotent: true });

        // Atomically assign next ON receipt
        const receiptNumber = await storage.nextReceiptNumber(schoolId, "ON");

        // Update fee record to Paid + insert payment record — wrapped in a single
        // transaction so both succeed or fail together.  If the INSERT fails for
        // any reason (schema mismatch, constraint violation, transient error),
        // the UPDATE is rolled back automatically: fee_record stays Unpaid, the
        // webhook returns 500, and Razorpay retries until both operations commit.
        const now = new Date();
        const activeSession = await storage.getActiveSession(schoolId);
        let idempotentDuplicate = false;
        try {
          await db.transaction(async (tx) => {
            await tx.execute(sql`
              UPDATE fee_records
              SET status = 'Paid', paid_date = ${now.toISOString()}, receipt_number = ${receiptNumber}
              WHERE id = ${feeRecordId} AND school_id = ${schoolId}
            `);

            // Insert payment record — guarded against duplicate delivery (23505).
            // Any error thrown here rolls back the UPDATE above automatically.
            try {
              await tx.insert(paymentRecords).values({
                schoolId,
                sessionId: activeSession?.id ?? null,
                feeRecordId,
                studentId: Number(feeRec.student_id),
                paymentMethod: "Online",
                referenceNumber: payment.id,        // pay_XXXX
                receivedDate: now.toISOString().slice(0, 10),
                amount: Number(feeRec.amount) + lateFeeFromNotes,
                lateFeePaid: lateFeeFromNotes,
                cashierNotes: `Razorpay payment ID: ${payment.id}`,
                recordedBy: null,
                receiptNumber,
                idempotencyKey: `rzp_${payment.id}`,
                // Payment instrument metadata — available directly on the webhook payload
                // (no extra Razorpay API call needed here).
                paymentMode:      payment.method    ?? null,
                bankName:         payment.bank       ?? null,
                cardLast4:        payment.card?.last4 ?? null,
                vpa:              payment.vpa         ?? null,
                razorpayPaymentId: payment.id         ?? null,
                razorpayOrderId:   payment.order_id   ?? null,
                payerContact:     payment.contact    ?? null,
                payerEmail:       payment.email      ?? null,
                gatewayStatus:    "captured",
              } as any);
            } catch (insertErr: any) {
              // Unique-constraint on idempotency_key (PG 23505) = Razorpay re-sent
              // this webhook while the first handler's transaction was in flight or
              // has already committed.  Throwing rolls back our UPDATE; the winner's
              // committed state (including its receipt_number) is preserved on
              // fee_records.  Signal idempotent 200 outside the transaction.
              if (
                insertErr?.code === "23505" &&
                String(insertErr?.constraint ?? insertErr?.message ?? "").includes("idempotency_key")
              ) {
                console.warn(
                  "[razorpay webhook] duplicate payment.captured delivery — rolling back and returning idempotent 200",
                  insertErr?.constraint ?? insertErr?.message,
                );
                idempotentDuplicate = true;
              }
              throw insertErr; // always rethrow — rolls back the transaction
            }
          });
        } catch (txErr: any) {
          if (idempotentDuplicate) {
            return res.json({ ok: true, idempotent: true });
          }
          throw txErr; // non-idempotency error → outer catch → 500, Razorpay retries
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

        // Write to payment_attempts (non-blocking; existing payment_records write is the source of truth for receipts)
        void upsertPaymentAttempt({
          schoolId,
          studentId:         Number(feeRec.student_id),
          feeRecordId,
          sessionId:         activeSession?.id ?? null,
          outcome:           "captured",
          razorpayPaymentId: payment.id          ?? null,
          razorpayOrderId:   payment.order_id    ?? null,
          amountPaise:       payment.amount      != null ? Number(payment.amount) : Number(feeRec.amount) * 100,
          currency:          payment.currency    ?? "INR",
          paymentMethod:     payment.method      ?? null,
          cardNetwork:       payment.card?.network  ?? null,
          cardLast4:         payment.card?.last4    ?? null,
          cardType:          payment.card?.type     ?? null,
          cardIssuer:        payment.card?.issuer   ?? null,
          bankName:          payment.bank           ?? null,
          bankRrn:           (() => { const r = payment.acquirer_data?.rrn; return r && r !== "--" && r !== "---" ? r : null; })(),
          bankAuthCode:      payment.card?.auth_code ?? payment.acquirer_data?.auth_code ?? null,
          vpa:               payment.vpa            ?? null,
          wallet:            payment.wallet         ?? null,
          payerEmail:        payment.email          ?? null,
          payerContact:      payment.contact        ?? null,
          rzpCreatedAt:      payment.created_at  ? new Date(payment.created_at * 1000) : null,
          rzpCapturedAt:     now,
          webhookEvent:      "payment.captured",
          webhookReceivedAt: now,
          webhookVerified:   true,
          webhookPayload:    payment,
          source:            "webhook",
          receiptNumber,
        }).catch(err => console.warn("[webhook] payment_attempts upsert (captured) failed:", err));

        // Background: fetch fee/tax/acquirer data from Razorpay API (fire-and-forget after 200)
        if (payment.id) {
          void (async () => {
            try {
              const { paymentData, orderData } = await fetchRazorpayData(payment.id, payment.order_id ?? null, creds);
              if (paymentData) {
                await upsertPaymentAttempt({
                  schoolId,
                  studentId:  Number(feeRec.student_id),
                  feeRecordId,
                  sessionId:  activeSession?.id ?? null,
                  outcome:    "captured",
                  source:     "webhook",
                  receiptNumber,
                  webhookEvent:    "payment.captured",
                  webhookVerified: true,
                  ...mapRazorpayPayment(paymentData),
                  razorpayOrderData: orderData,
                });
              }
            } catch (enrichErr) {
              console.warn("[webhook] captured enrichment failed:", enrichErr);
            }
          })();
        }

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

        // Resolve the academic session for this fee record so the attempt is
        // correctly linked to the right session even when viewSessionId is not set.
        let webhookFeeSessionId: number | null = null;
        if (feeRecordId) {
          const sessionRow = (await db.execute(sql`
            SELECT session_id FROM fee_records WHERE id = ${feeRecordId} LIMIT 1
          `)).rows[0] as any;
          webhookFeeSessionId = sessionRow?.session_id ?? null;
        }

        const webhookRawJson = JSON.stringify(payment ?? {});
        const webhookDesc =
          "Razorpay payment failed — " + errCode + ": " + errDesc +
          (payment.id ? " (" + payment.id + ")" : "") +
          (fallbackUsed ? " [context recovered via order_id fallback]" : "") +
          (notesIncomplete && !fallbackUsed ? " [incomplete notes — student/fee could not be identified]" : "");

        await db.execute(sql`
          INSERT INTO fee_audit_log (
            school_id, action, entity_type, entity_id, actor_id, actor_name, student_id,
            session_id, razorpay_payment_id, razorpay_order_id, amount, currency,
            error_code, error_source, error_step, error_reason, payment_method,
            raw_response, description, created_at
          ) VALUES (
            ${schoolId}, 'payment_failed', 'fee_record',
            ${feeRecordId ?? null}, NULL, 'Razorpay Webhook', ${studentIdResolved},
            ${webhookFeeSessionId},
            ${payment.id        ?? null},
            ${payment.order_id  ?? null},
            ${payment.amount    ?? null},
            ${payment.currency  ?? "INR"},
            ${errCode !== "UNKNOWN" ? errCode : null},
            ${payment.error_source ?? null},
            ${payment.error_step   ?? null},
            ${payment.error_reason ?? null},
            ${payment.method       ?? null},
            ${webhookRawJson}::jsonb,
            ${webhookDesc},
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

        // Write to payment_attempts — webhook payload already has card + error details
        void upsertPaymentAttempt({
          schoolId,
          studentId:         studentIdResolved,
          feeRecordId,
          sessionId:         webhookFeeSessionId,
          outcome:           "failed",
          razorpayPaymentId: payment.id          ?? null,
          razorpayOrderId:   payment.order_id    ?? null,
          amountPaise:       payment.amount != null ? Number(payment.amount) : null,
          currency:          payment.currency    ?? "INR",
          paymentMethod:     payment.method      ?? null,
          cardNetwork:       payment.card?.network  ?? null,
          cardLast4:         payment.card?.last4    ?? null,
          cardType:          payment.card?.type     ?? null,
          cardIssuer:        payment.card?.issuer   ?? null,
          bankName:          payment.bank           ?? null,
          bankRrn:           (() => { const r = payment.acquirer_data?.rrn; return r && r !== "--" && r !== "---" ? r : null; })(),
          bankAuthCode:      payment.card?.auth_code ?? payment.acquirer_data?.auth_code ?? null,
          vpa:               payment.vpa            ?? null,
          wallet:            payment.wallet         ?? null,
          payerEmail:        payment.email          ?? null,
          payerContact:      payment.contact        ?? null,
          errorCode:         errCode !== "UNKNOWN" ? errCode : null,
          errorDescription:  payment.error_description ?? null,
          errorSource:       payment.error_source   ?? null,
          errorStep:         payment.error_step     ?? null,
          errorReason:       payment.error_reason   ?? null,
          rzpCreatedAt:      payment.created_at ? new Date(payment.created_at * 1000) : null,
          rzpFailedAt:       now,
          webhookEvent:      "payment.failed",
          webhookReceivedAt: now,
          webhookVerified:   true,
          webhookPayload:    payment,
          source:            "webhook",
        }).catch(err => console.warn("[webhook] payment_attempts upsert (failed) error:", err));

        console.log(`[razorpay webhook] Payment failed for fee #${feeRecordId}: ${errCode} — ${errDesc}`);

      // ── payment.authorized ───────────────────────────────────────────────────
      // Some UPI / netbanking flows send authorized → captured.
      // Do NOT mark fee as Paid here — wait for payment.captured.
      } else if (event.event === "payment.authorized") {
        const feeRecordId = notes.feeRecordId ? parseInt(notes.feeRecordId) : null;
        const studentIdAu = notes.studentId  ? parseInt(notes.studentId)  : null;
        const now = new Date();
        await db.execute(sql`
          INSERT INTO fee_audit_log
            (school_id, action, entity_type, entity_id, actor_id, actor_name, student_id, description, created_at)
          VALUES (
            ${schoolId}, 'payment_authorized', 'fee_record',
            ${feeRecordId}, NULL, 'Razorpay Webhook', ${studentIdAu},
            ${"Payment authorized (awaiting capture) — " + (payment.id ?? "unknown")},
            ${now.toISOString()}
          )
        `);
        // Write to payment_attempts
        void upsertPaymentAttempt({
          schoolId,
          studentId:         studentIdAu,
          feeRecordId,
          sessionId:         null,
          outcome:           "authorized",
          razorpayPaymentId: payment.id        ?? null,
          razorpayOrderId:   payment.order_id  ?? null,
          amountPaise:       payment.amount != null ? Number(payment.amount) : null,
          currency:          payment.currency  ?? "INR",
          paymentMethod:     payment.method    ?? null,
          cardNetwork:       payment.card?.network ?? null,
          cardLast4:         payment.card?.last4   ?? null,
          vpa:               payment.vpa           ?? null,
          rzpCreatedAt:      payment.created_at ? new Date(payment.created_at * 1000) : null,
          rzpAuthorizedAt:   now,
          webhookEvent:      "payment.authorized",
          webhookReceivedAt: now,
          webhookVerified:   true,
          webhookPayload:    payment,
          source:            "webhook",
        }).catch(err => console.warn("[webhook] payment_attempts upsert (authorized) error:", err));

        console.log(`[razorpay webhook] payment.authorized fee #${feeRecordId} — ${payment.id ?? "?"}`);

      // ── refund.* ─────────────────────────────────────────────────────────────
      } else if (["refund.created", "refund.processed", "refund.failed", "refund.speed_changed"].includes(event.event)) {
        const refund        = event?.payload?.refund?.entity  ?? {};
        const refPmtEntity  = event?.payload?.payment?.entity ?? {};
        const refPmtId      = refund.payment_id ?? refPmtEntity.id ?? null;
        let rfFeeRecordId: number | null = null;
        let rfStudentId:   number | null = null;
        if (refPmtId) {
          const pr = (await db.execute(sql`
            SELECT fee_record_id, student_id FROM payment_records
            WHERE school_id = ${schoolId} AND reference_number = ${refPmtId}
            LIMIT 1
          `)).rows[0] as any;
          if (pr) { rfFeeRecordId = Number(pr.fee_record_id); rfStudentId = Number(pr.student_id); }
        }
        const now = new Date();
        const amtRs = (Number(refund.amount ?? 0) / 100).toFixed(2);
        const rfAction =
          event.event === "refund.created"   ? "refund_initiated" :
          event.event === "refund.processed" ? "refund_processed" :
          event.event === "refund.failed"    ? "refund_failed"    : "refund_updated";
        const rfDesc =
          event.event === "refund.created"      ? `Refund initiated — ₹${amtRs} — refund ID: ${refund.id ?? "?"} — payment: ${refPmtId ?? "?"}` :
          event.event === "refund.processed"    ? `Refund completed — ₹${amtRs} — refund ID: ${refund.id ?? "?"} — payment: ${refPmtId ?? "?"}` :
          event.event === "refund.failed"       ? `Refund failed — ₹${amtRs} — refund ID: ${refund.id ?? "?"} — payment: ${refPmtId ?? "?"}` :
                                                  `Refund speed changed — refund ID: ${refund.id ?? "?"}`;
        await db.execute(sql`
          INSERT INTO fee_audit_log
            (school_id, action, entity_type, entity_id, actor_id, actor_name, student_id, description, created_at)
          VALUES (
            ${schoolId}, ${rfAction}, 'fee_record',
            ${rfFeeRecordId}, NULL, 'Razorpay Webhook', ${rfStudentId},
            ${rfDesc}, ${now.toISOString()}
          )
        `);
        // Update payment_attempts with refund data
        if (refPmtId && refund.id) {
          const rfOutcome  = event.event === "refund.processed" ? "refunded" : "captured";
          const rfStatus   = event.event === "refund.created"   ? "initiated"
                           : event.event === "refund.processed" ? "processed"
                           : event.event === "refund.failed"    ? "failed"
                                                                : "updated";
          void updatePaymentAttemptRefund(
            schoolId, refPmtId, refund.id, rfStatus,
            refund.amount != null ? Number(refund.amount) : null,
            now,
            event.event === "refund.processed" ? now : null,
            rfOutcome,
          ).catch(err => console.warn("[webhook] updatePaymentAttemptRefund error:", err));
        }

        console.log(`[razorpay webhook] ${event.event} fee #${rfFeeRecordId} refund ${refund.id ?? "?"}`);

      // ── payment.dispute.* ────────────────────────────────────────────────────
      } else if (event.event.startsWith("payment.dispute.")) {
        const dispute   = event?.payload?.dispute?.entity  ?? {};
        const disPmt    = event?.payload?.payment?.entity  ?? {};
        const disPmtId  = dispute.payment_id ?? disPmt.id ?? null;
        let disFeeId:  number | null = null;
        let disStudId: number | null = null;
        if (disPmtId) {
          const pr = (await db.execute(sql`
            SELECT fee_record_id, student_id FROM payment_records
            WHERE school_id = ${schoolId} AND reference_number = ${disPmtId}
            LIMIT 1
          `)).rows[0] as any;
          if (pr) { disFeeId = Number(pr.fee_record_id); disStudId = Number(pr.student_id); }
        }
        const now = new Date();
        const disAmtRs  = (Number(dispute.amount ?? 0) / 100).toFixed(2);
        const disLabel: Record<string, string> = {
          "payment.dispute.created":         "Dispute raised by student",
          "payment.dispute.won":             "Dispute resolved — decided in our favour",
          "payment.dispute.lost":            "Dispute lost — payment reversed to student",
          "payment.dispute.closed":          "Dispute closed",
          "payment.dispute.under_review":    "Dispute under review",
          "payment.dispute.action_required": "⚠️ Dispute action required — respond in Razorpay Dashboard",
        };
        const disAction =
          event.event === "payment.dispute.created"  ? "dispute_created" :
          event.event === "payment.dispute.won"      ? "dispute_won"     :
          event.event === "payment.dispute.lost"     ? "dispute_lost"    : "dispute_updated";
        const disDesc = `${disLabel[event.event] ?? event.event} — ₹${disAmtRs} — dispute ID: ${dispute.id ?? "?"} — payment: ${disPmtId ?? "?"} — reason: ${dispute.reason_code ?? "unknown"}`;
        await db.execute(sql`
          INSERT INTO fee_audit_log
            (school_id, action, entity_type, entity_id, actor_id, actor_name, student_id, description, created_at)
          VALUES (
            ${schoolId}, ${disAction}, 'fee_record',
            ${disFeeId}, NULL, 'Razorpay Webhook', ${disStudId},
            ${disDesc}, ${now.toISOString()}
          )
        `);
        // Broadcast high-severity dispute events to admin dashboard
        if (event.event === "payment.dispute.created" || event.event === "payment.dispute.action_required" || event.event === "payment.dispute.lost") {
          // Notify admin dashboard — no receipt number for disputes, pass empty string
          broadcastPaymentUpdate(schoolId, { feeRecordId: disFeeId ?? 0, receiptNumber: "" });
        }
        console.log(`[razorpay webhook] ${event.event} dispute ${dispute.id ?? "?"} fee #${disFeeId}`);

      // ── payment.downtime.* ───────────────────────────────────────────────────
      } else if (event.event.startsWith("payment.downtime.")) {
        const dt     = event?.payload?.downtime?.entity ?? {};
        const method = dt.method ?? "unknown";
        console.warn(`[razorpay webhook] ⚠️ Razorpay downtime — ${event.event} — method: ${method} — status: ${dt.status ?? "?"}`);

      // ── all other events ─────────────────────────────────────────────────────
      // (order.paid, order.notification.*, invoice.*, settlement.processed,
      //  fund_account.*, account.*, payment_link.*, etc.)
      // Razorpay requires 200 for all events — acknowledge and log only.
      } else {
        console.log(`[razorpay webhook] acknowledged (no action): ${event.event}`);
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

    const {
      feeRecordId, razorpayOrderId, razorpayPaymentId,
      errorCode, errorDescription, errorSource, errorStep, errorReason,
      isCancelled,   // true when student voluntarily closed the checkout modal
      rawResponse,   // full Razorpay error response object from the SDK
    } = req.body ?? {};
    if (!feeRecordId || typeof feeRecordId !== "number")
      return res.status(400).json({ message: "feeRecordId required" });

    // Students MUST supply the order ID they received — this prevents a
    // malicious call from clearing another student's active payment lock.
    if (studentId && !razorpayOrderId)
      return res.status(400).json({ message: "razorpayOrderId required" });

    // Resolve schoolId — students use session.schoolId via their own session,
    // admins already have it directly.
    let schoolId: number | null = adminSchId ?? null;
    if (!schoolId && studentId) {
      const student = await storage.getStudentById(studentId);
      schoolId = student?.schoolId ?? null;
    }
    if (!schoolId) return res.status(403).json({ message: "School not found" });

    // Build WHERE clause:
    //  • Always scope to school and fee record.
    //  • Students: must also match student_id (ownership) AND the specific order ID.
    //  • Admins: order ID match is strongly preferred; omitting it is allowed for
    //    operational recovery of stuck orders.
    const condition = studentId
      ? sql`id = ${feeRecordId} AND school_id = ${schoolId} AND student_id = ${studentId} AND razorpay_order_id = ${razorpayOrderId}`
      : razorpayOrderId
        ? sql`id = ${feeRecordId} AND school_id = ${schoolId} AND razorpay_order_id = ${razorpayOrderId}`
        : sql`id = ${feeRecordId} AND school_id = ${schoolId}`;

    await db.execute(sql`
      UPDATE fee_records
      SET razorpay_order_id         = NULL,
          razorpay_order_expires_at = NULL
      WHERE ${condition}
        AND status IN ('Due', 'Overdue', 'Partial')
    `);

    // ── Write payment_failed / payment_cancelled audit log entry ─────────────
    // isCancelled=true means the student voluntarily closed the checkout modal
    // (no payment was attempted); isCancelled=false means Razorpay reported a
    // real payment failure (card declined, gateway error, etc.).
    // The webhook also writes payment_failed entries — two entries for one
    // failure is acceptable; zero entries is not.
    const clientAction = isCancelled ? "payment_cancelled" : "payment_failed";
    const now = new Date();

    // Resolve session_id and amount from the fee record for full audit trail
    let clientFeeSessionId: number | null = null;
    let clientFeeAmount: number | null = null;
    if (feeRecordId) {
      try {
        const feeRow = (await db.execute(sql`
          SELECT session_id, amount FROM fee_records WHERE id = ${feeRecordId} LIMIT 1
        `)).rows[0] as any;
        clientFeeSessionId = feeRow?.session_id ?? null;
        clientFeeAmount    = feeRow?.amount     ?? null;
      } catch { /* non-fatal */ }
    }

    const descParts: string[] = [
      isCancelled
        ? "Razorpay checkout cancelled (client-reported)"
        : "Razorpay payment failed (client-reported)",
    ];
    if (errorCode)        descParts.push(`${errorCode}`);
    if (errorDescription) descParts.push(`${errorDescription}`);
    if (razorpayPaymentId) descParts.push(`(${razorpayPaymentId})`);
    if (razorpayOrderId)   descParts.push(`[order: ${razorpayOrderId}]`);
    const description = descParts.join(" — ").replace(/ — —/g, " —");

    // Sanitise rawResponse before storing: drop any payer contact/email that
    // the student may not have consented to persist server-side.
    const safeRaw = rawResponse
      ? JSON.stringify(
          typeof rawResponse === "object"
            ? { ...rawResponse, contact: undefined, email: undefined }
            : rawResponse
        )
      : null;

    try {
      await db.execute(sql`
        INSERT INTO fee_audit_log (
          school_id, action, entity_type, entity_id, actor_id, actor_name, student_id,
          session_id, razorpay_payment_id, razorpay_order_id, amount,
          error_code, error_source, error_step, error_reason,
          raw_response, description, created_at
        ) VALUES (
          ${schoolId}, ${clientAction}, 'fee_record', ${feeRecordId},
          NULL, 'Razorpay (client)', ${studentId ?? null},
          ${clientFeeSessionId},
          ${razorpayPaymentId ?? null},
          ${razorpayOrderId   ?? null},
          ${clientFeeAmount   ?? null},
          ${errorCode         ?? null},
          ${errorSource       ?? null},
          ${errorStep         ?? null},
          ${errorReason       ?? null},
          ${safeRaw}::jsonb,
          ${description},
          ${now.toISOString()}
        )
      `);
    } catch (auditErr) {
      // Non-fatal — log but don't fail the response
      console.warn("[clear-failed-order] audit log write failed:", auditErr);
    }

    // Write to payment_attempts (non-fatal)
    const attemptOutcome = isCancelled ? "cancelled" : "failed";
    void upsertPaymentAttempt({
      schoolId,
      studentId:         studentId ?? null,
      feeRecordId:       feeRecordId ?? null,
      sessionId:         clientFeeSessionId,
      outcome:           attemptOutcome,
      razorpayPaymentId: razorpayPaymentId ?? null,
      razorpayOrderId:   razorpayOrderId   ?? null,
      amountPaise:       clientFeeAmount != null ? clientFeeAmount * 100 : null,
      errorCode:         errorCode         ?? null,
      errorDescription:  (req.body as any).errorDescription ?? null,
      errorSource:       errorSource       ?? null,
      errorStep:         errorStep         ?? null,
      errorReason:       errorReason       ?? null,
      webhookVerified:   false,
      source:            "client",
    }).catch(err => console.warn("[clear-failed-order] payment_attempts write failed:", err));

    // If a Razorpay payment ID is present (client-side failure, not a voluntary
    // dismiss), background-fetch from Razorpay API for card / error enrichment.
    if (razorpayPaymentId && !isCancelled) {
      void (async () => {
        try {
          const clientCreds = await resolveRazorpayCredentials(schoolId);
          if (!clientCreds) return;
          const { paymentData, orderData } = await fetchRazorpayData(razorpayPaymentId, razorpayOrderId ?? null, clientCreds);
          if (paymentData) {
            await upsertPaymentAttempt({
              schoolId,
              studentId:   studentId ?? null,
              feeRecordId: feeRecordId ?? null,
              sessionId:   clientFeeSessionId,
              outcome:     "failed",
              razorpayPaymentId,
              razorpayOrderId:   razorpayOrderId ?? null,
              source:      "client",
              ...mapRazorpayPayment(paymentData),
              razorpayOrderData: orderData,
              apiSyncedAt: new Date(),
            });
          }
        } catch (enrichErr) {
          console.warn("[clear-failed-order] enrichment failed:", enrichErr);
        }
      })();
    }

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

    const { razorpay_payment_id, razorpay_order_id, razorpay_signature, feeRecordId,
            payer_name, payer_email, payer_contact } = req.body;
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

      // Already Paid? Idempotent — return success immediately, then try to fill in
      // payment_mode metadata in case the webhook INSERT missed it (e.g. older code path
      // or a rare webhook delivery gap).
      if (feeRec.status === "Paid") {
        // Non-blocking enrichment — fire and forget so the response is instant.
        (async () => {
          try {
            const rzpClient = new Razorpay({ key_id: creds.keyId, key_secret: creds.keySecret });
            const rzpPay = await (rzpClient.payments as any).fetch(razorpay_payment_id);
            await db.execute(sql`
              UPDATE payment_records
              SET payment_mode  = COALESCE(payment_mode,  ${rzpPay.method    ?? null}),
                  bank_name     = COALESCE(bank_name,     ${rzpPay.bank       ?? null}),
                  card_last4    = COALESCE(card_last4,    ${rzpPay.card?.last4 ?? null}),
                  vpa           = COALESCE(vpa,           ${rzpPay.vpa         ?? null}),
                  payer_contact = COALESCE(payer_contact, ${rzpPay.contact     ?? null}),
                  payer_email   = COALESCE(payer_email,   ${rzpPay.email       ?? null})
              WHERE idempotency_key = ${"rzp_" + razorpay_payment_id}
            `);
          } catch (metaErr) {
            console.warn(
              `[razorpay verify idempotent] metadata fill failed for payment ${razorpay_payment_id}: ` +
              `${(metaErr as any)?.message ?? metaErr}`,
            );
          }
        })();
        return res.json({ ok: true, idempotent: true, receiptNumber: feeRec.receipt_number });
      }

      // Read the frozen late-fee snapshot from the Razorpay order notes — the
      // identical source the webhook handler reads via notes.lateFeeAmount (line ~1739).
      // This ensures payment_records stores the same amounts whether the webhook or
      // the client-verify path commits first.
      // Fail-safe: if the fetch throws (Razorpay unavailable, network error), we
      // catch and default to 0.  The payment still commits correctly; only
      // late_fee_paid = 0 is recorded, which matches the pre-fix behaviour and does
      // not affect the payment amount itself.
      let lateFeeFromOrder = 0;
      try {
        const rzpOrderClient = new Razorpay({ key_id: creds.keyId, key_secret: creds.keySecret });
        const rzpOrderData = await (rzpOrderClient.orders as any).fetch(razorpay_order_id);
        lateFeeFromOrder = Math.round(Number(rzpOrderData?.notes?.lateFeeAmount ?? 0)) || 0;
      } catch (orderNotesErr) {
        console.warn(
          `[razorpay verify] order notes fetch failed for ${razorpay_order_id} — ` +
          `late_fee_paid will be recorded as 0. Error: ${(orderNotesErr as any)?.message ?? orderNotesErr}`,
        );
      }

      // Mark Paid — wrap UPDATE + INSERT in a single transaction so a crash or
      // INSERT failure (schema mismatch, constraint violation, transient DB error)
      // can never leave fee_records stamped Paid without a matching payment_records
      // row.  Matches the pattern used in the webhook handler.
      const receiptNumber = await storage.nextReceiptNumber(schoolId, "ON");
      const now = new Date();
      const activeSession = await storage.getActiveSession(schoolId);

      let idempotentDuplicate = false;
      let canonicalReceipt: string | undefined;

      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`
            UPDATE fee_records
            SET status = 'Paid', paid_date = ${now.toISOString()}, receipt_number = ${receiptNumber}
            WHERE id = ${feeRecordId} AND school_id = ${schoolId}
          `);

          // Insert payment record inside the same transaction — any failure here
          // automatically rolls back the UPDATE above, so the fee stays Due and
          // the student can retry.
          try {
            await tx.insert(paymentRecords).values({
              schoolId,
              sessionId: activeSession?.id ?? null,
              feeRecordId,
              studentId: Number(feeRec.student_id),
              paymentMethod: "Online",
              referenceNumber: razorpay_payment_id,
              receivedDate: now.toISOString().slice(0, 10),
              amount: Number(feeRec.amount) + lateFeeFromOrder,
              lateFeePaid: lateFeeFromOrder,
              cashierNotes: `Razorpay payment ID: ${razorpay_payment_id} (client-verified)`,
              recordedBy: null,
              receiptNumber,
              idempotencyKey: `rzp_${razorpay_payment_id}`,
              razorpayPaymentId: razorpay_payment_id ?? null,
              razorpayOrderId: razorpay_order_id ?? null,
              razorpaySignature: razorpay_signature ?? null,
              payerName: payer_name ?? null,
              payerEmail: payer_email ?? null,
              payerContact: payer_contact ?? null,
              gatewayStatus: "captured",
            } as any);
          } catch (insertErr: any) {
            // Unique-constraint on idempotency_key (PG 23505) means the webhook
            // already inserted a payment_records row for this payment_id while
            // our transaction was in flight or just before we started.  Throwing
            // rolls back our UPDATE, preserving the winner's committed state
            // (including its receipt_number on fee_records).
            if (
              insertErr?.code === "23505" &&
              String(insertErr?.constraint ?? insertErr?.message ?? "").includes("idempotency_key")
            ) {
              console.warn(
                "[razorpay verify] duplicate idempotency_key — rolling back and returning idempotent 200",
                insertErr?.constraint ?? insertErr?.message,
              );
              idempotentDuplicate = true;
            }
            throw insertErr; // always rethrow — rolls back the transaction
          }
        });
      } catch (txErr: any) {
        if (idempotentDuplicate) {
          // The webhook already committed a payment_records row for this payment.
          // Look up the canonical receipt it stamped so we return the right number.
          try {
            const winnerRows = (await db.execute(sql`
              SELECT receipt_number FROM payment_records
              WHERE idempotency_key = ${"rzp_" + razorpay_payment_id}
              LIMIT 1
            `)).rows;
            canonicalReceipt = (winnerRows[0] as any)?.receipt_number as string | undefined;
          } catch {/* non-critical — fall through to idempotent OK */ }
          return res.json({ ok: true, idempotent: true, receiptNumber: canonicalReceipt });
        }
        console.error("[razorpay verify]", txErr);
        return res.status(500).json({ message: String(txErr) });
      }

      // Try to enrich with Razorpay Payments API (mode, bank, card, VPA) — non-blocking
      try {
        const rzpClient = new Razorpay({ key_id: creds.keyId, key_secret: creds.keySecret });
        const rzpPay = await (rzpClient.payments as any).fetch(razorpay_payment_id);
        await db.execute(sql`
          UPDATE payment_records
          SET payment_mode   = ${rzpPay.method    ?? null},
              bank_name      = ${rzpPay.bank       ?? null},
              card_last4     = ${rzpPay.card?.last4 ?? null},
              vpa            = ${rzpPay.vpa         ?? null},
              payer_contact  = COALESCE(payer_contact, ${rzpPay.contact ?? null}),
              payer_email    = COALESCE(payer_email,   ${rzpPay.email   ?? null})
          WHERE idempotency_key = ${"rzp_" + razorpay_payment_id}
        `);
      } catch (metaErr) {
        // Non-blocking — the payment is already confirmed; mode data will be NULL
        // in the student's History tab until a manual re-fetch or future webhook updates it.
        // Ops can identify affected records by: SELECT id FROM payment_records WHERE payment_mode IS NULL AND payment_method = 'Online' AND razorpay_payment_id IS NOT NULL;
        console.warn(
          `[razorpay verify] metadata fetch failed for payment ${razorpay_payment_id} — ` +
          `payment_mode will be NULL in History tab. Error: ${(metaErr as any)?.message ?? metaErr}`,
        );
      }

      await db.execute(sql`
        INSERT INTO fee_audit_log (school_id, action, entity_type, entity_id, actor_id, student_id, description, created_at)
        VALUES (${schoolId}, 'payment', 'fee_record', ${feeRecordId}, NULL,
          ${Number(feeRec.student_id)},
          ${"Online payment via Razorpay — " + razorpay_payment_id + " — receipt " + receiptNumber + " (client-verified)"},
          ${now.toISOString()})
      `);

      // Record in payment_attempts — this is the primary write for the client-verify path.
      // The webhook (payment.captured) may arrive later and upsert the same row idempotently.
      void upsertPaymentAttempt({
        schoolId,
        studentId:         Number(feeRec.student_id),
        feeRecordId,
        sessionId:         activeSession?.id ?? null,
        outcome:           "captured",
        razorpayPaymentId: razorpay_payment_id,
        razorpayOrderId:   razorpay_order_id   ?? null,
        amountPaise:       typeof feeRec.amount === "number" ? feeRec.amount * 100 : null,
        currency:          "INR",
        payerEmail:        payer_email   ?? null,
        payerContact:      payer_contact ?? null,
        payerName:         payer_name    ?? null,
        webhookEvent:      "verify",
        webhookReceivedAt: now,
        source:            "client",
        receiptNumber,
      }).catch(err => console.error(
        `[razorpay verify] ⚠ payment_attempts upsert FAILED for ${razorpay_payment_id} ` +
        `fee #${feeRecordId} — History tab may be incomplete until webhook arrives:`,
        err,
      ));

      // Fire-and-forget API enrichment for payment_attempts (mode, card, RRN, fee, GST)
      if (creds.keySecret) {
        void (async () => {
          try {
            const { paymentData, orderData } = await fetchRazorpayData(razorpay_payment_id, razorpay_order_id ?? null, creds);
            if (paymentData) {
              await upsertPaymentAttempt({
                schoolId,
                studentId:       Number(feeRec.student_id),
                feeRecordId,
                sessionId:       activeSession?.id ?? null,
                outcome:         "captured",
                source:          "client",
                receiptNumber,
                webhookEvent:    "verify",
                webhookVerified: true,
                ...mapRazorpayPayment(paymentData),
              });
            }
          } catch (enrichErr) {
            console.warn(`[razorpay verify] API enrichment failed for ${razorpay_payment_id}:`, enrichErr);
          }
        })();
      }

      broadcastPaymentUpdate(schoolId, { feeRecordId, receiptNumber });
      console.log(`[razorpay verify] Paid fee #${feeRecordId} receipt ${receiptNumber}`);

      res.json({ ok: true, receiptNumber });
    } catch (err: any) {
      console.error("[razorpay verify]", err);
      res.status(500).json({ message: String(err) });
    }
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
      // feePeriodStart/feePeriodEnd: required for monthly/quarterly fees (admin picks the month).
      // For annual/one-time the backend uses the active session dates automatically.
      feePeriodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
      feePeriodEnd:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });

    const { feePeriodStart: bodyPeriodStart, feePeriodEnd: bodyPeriodEnd } = parsed.data;
    const structure = await storage.getFeeStructureById(structureId, schoolId);
    if (!structure) return res.status(404).json({ message: "Fee structure not found" });
    // Academic session is always the currently active session — the client cannot override this.
    const invoiceSession = await storage.getActiveSession(schoolId);
    if (!invoiceSession) return res.status(400).json({ message: "No active academic session found. Please activate a session first." });
    const sessionId = invoiceSession.id;

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

    // Determine the immutable fee period for this batch.
    // Priority: explicit body params (monthly/quarterly admin pick) → session dates (annual/one-time).
    const freq: string = (structure as any).frequency ?? "annual";
    let periodStart: string;
    let periodEnd:   string;
    if (bodyPeriodStart && bodyPeriodEnd) {
      // Admin explicitly selected a fee period in the UI (monthly/quarterly).
      // Validate that the selected period falls within the active session.
      const sessStart = String(invoiceSession.startDate).slice(0, 10);
      const sessEnd   = String(invoiceSession.endDate).slice(0, 10);
      if (bodyPeriodStart < sessStart || bodyPeriodEnd > sessEnd) {
        return res.status(400).json({ message: "The selected fee period is outside the active academic session." });
      }
      periodStart = bodyPeriodStart;
      periodEnd   = bodyPeriodEnd;
    } else {
      // Annual/one-time: use academic session start/end as the period.
      periodStart = String(invoiceSession.startDate).slice(0, 10);
      periodEnd   = String(invoiceSession.endDate).slice(0, 10);
    }

    // Compute the invoice due date from the fee structure's dueDayOfMonth + the period's month.
    // For monthly/quarterly fees, the due date falls within the fee period month.
    // For annual/one-time, the due date falls within the session's start month.
    const dueDayOfMonth: number | null = (structure as any).dueDayOfMonth ?? null;
    let dueDate: string;
    if (dueDayOfMonth) {
      const refDate = new Date(periodStart + "T00:00:00");
      const y = refDate.getFullYear();
      const m = refDate.getMonth();
      const lastDay = new Date(y, m + 1, 0).getDate();
      const d = Math.min(dueDayOfMonth, lastDay);
      dueDate = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    } else {
      // No due day configured on the structure — fall back to the last day of the fee period.
      dueDate = periodEnd;
    }

    const existingRecords = await storage.getFeeRecordsBySchool(schoolId, { sessionId });

    // Period-based idempotency: one invoice per student × feeType × feePeriodStart.
    // Falls back to legacy "studentId:feeType" key for pre-migration records (null feePeriodStart).
    const existingByPeriodStart = new Map(
      existingRecords
        .filter((r: any) => r.feePeriodStart)
        .map((r: any) => [`${r.studentId}:${r.feeType}:${String(r.feePeriodStart).slice(0, 10)}`, r])
    );
    const existingByType = new Map(
      existingRecords
        .filter((r: any) => !r.feePeriodStart)
        .map((r: any) => [`${r.studentId}:${r.feeType}`, r])
    );

    // Build the immutable breakdown snapshot once for this structure before the student loop.
    // Throws on invalid component data (empty name, negative/non-finite amount) — return 400.
    let breakdownSnap2: Array<{ name: string; purpose: string; amount: number }>;
    try {
      breakdownSnap2 = buildBreakdownSnapshot((structure as any).breakdown);
      warnOnSumMismatch(breakdownSnap2, structure.amount, `structure "${structure.name}"`);
    } catch (snapErr: any) {
      return res.status(400).json({ message: `Invalid fee component breakdown: ${snapErr.message}` });
    }

    let created = 0, skipped = 0;
    for (const enrollment of filtered) {
      const periodKey = `${enrollment.studentId}:${structure.feeType}:${periodStart}`;
      const legacyKey = `${enrollment.studentId}:${structure.feeType}`;
      const existing = existingByPeriodStart.get(periodKey) ?? existingByType.get(legacyKey);
      if (existing) {
        // Invoice already exists for this student × feeType × period — skip completely.
        // Existing invoices are immutable through Generate Invoices: amount, due date,
        // and status are never updated regardless of changes to the fee structure.
        skipped++;
        continue;
      }
      // Assign a permanent invoice number — stored in invoice_number, never in receipt_number.
      // The INV- sequence is school-scoped, atomic, and never reused or reset.
      const invoiceNumber = await storage.nextReceiptNumber(schoolId, "INV-", 4);
      await storage.createFeeRecord({
        schoolId, studentId: enrollment.studentId, sessionId,
        feeType: structure.feeType, amount: structure.amount, dueDate, status: "Due",
        academicYear: invoiceSession?.sessionName ?? null,
        notes: null,
        invoiceNumber,
        feePeriodStart: periodStart,
        feePeriodEnd:   periodEnd,
        breakdownSnapshot: breakdownSnap2,
      } as any);
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
      `Generated invoices from "${structure.name}": ${created} created, ${skipped} already existed (skipped)${voided > 0 ? `, ${voided} out-of-scope voided` : ""}`);
    res.json({ created, synced: 0, skipped, voided, total: filtered.length });
  });

  // ── Receipt Number Preview (no-commit peek) ───────────────────────────────
  // Returns the NEXT receipt number without incrementing the sequence counter.
  // Used by the Add Fee and Record Offline Payment modals to show a preview.
  app.get("/api/admin/fees/next-receipt", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    // Accept "INV-" (invoice), "AF" (legacy fee records), "OF" (offline receipt).
    // Raw prefix from query is case-sensitive to preserve the hyphen in "INV-".
    const rawPrefix = String(req.query.prefix ?? "");
    if (!["INV-", "AF", "OF"].includes(rawPrefix)) {
      return res.status(400).json({ message: "prefix must be INV-, AF, or OF" });
    }
    // INV- uses 4-digit padding; legacy prefixes use 2-digit
    const padLength = rawPrefix === "INV-" ? 4 : 2;
    const preview = await storage.peekReceiptNumber(schoolId, rawPrefix, padLength);
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
    let feeInvoiceNumber: string | null = null;
    if (payment.feeRecordId) {
      const recs = await storage.getFeeRecordsByStudent(payment.studentId, schoolId);
      const feeRec = recs.find(r => r.id === payment.feeRecordId);
      feeType = feeRec?.feeType ?? null;
      feeInvoiceNumber = feeRec?.invoiceNumber ?? null;
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
    <tr><td>Invoice No.</td><td>${esc(feeInvoiceNumber ?? "—")}</td></tr>
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

  // ── Transaction Detail — JSON (for accordion in Ledger) ─────────────────
  app.get("/api/admin/fees/:id/transaction-detail", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const feeRecordId = parseInt(req.params.id);
    if (isNaN(feeRecordId)) return res.status(400).json({ message: "Invalid ID" });

    try {
      // Fee record + student
      const feeRow = (await db.execute(sql`
        SELECT fr.*,
               s.name AS student_name, s.digital_student_id, s.class, s.section,
               s.roll_number, s.guardian_name, s.phone, s.email AS student_email
        FROM fee_records fr
        JOIN students s ON s.id = fr.student_id
        WHERE fr.id = ${feeRecordId} AND fr.school_id = ${schoolId}
        LIMIT 1
      `)).rows[0] as any;
      if (!feeRow) return res.status(404).json({ message: "Fee record not found" });

      // Payment records (all for this fee, newest first)
      const payRows = (await db.execute(sql`
        SELECT * FROM payment_records
        WHERE fee_record_id = ${feeRecordId}
        ORDER BY created_at DESC
      `)).rows as any[];

      // Audit log entries for this fee record
      const auditRows = (await db.execute(sql`
        SELECT * FROM fee_audit_log
        WHERE entity_id = ${feeRecordId} AND entity_type = 'fee_record'
        ORDER BY created_at DESC
        LIMIT 20
      `)).rows as any[];

      const mapPayment = (p: any) => ({
        id: p.id,
        paymentMethod: p.payment_method,
        amount: Number(p.amount),
        lateFeePaid: Number(p.late_fee_paid ?? 0),
        receivedDate: p.received_date,
        referenceNumber: p.reference_number ?? null,
        cashierNotes: p.cashier_notes ?? null,
        receiptNumber: p.receipt_number ?? null,
        createdAt: p.created_at,
        razorpayPaymentId: p.razorpay_payment_id ?? null,
        razorpayOrderId: p.razorpay_order_id ?? null,
        razorpaySignature: p.razorpay_signature ?? null,
        paymentMode: p.payment_mode ?? null,
        bankName: p.bank_name ?? null,
        cardLast4: p.card_last4 ?? null,
        vpa: p.vpa ?? null,
        payerName: p.payer_name ?? null,
        payerEmail: p.payer_email ?? null,
        payerContact: p.payer_contact ?? null,
        gatewayStatus: p.gateway_status ?? null,
      });

      res.json({
        feeRecord: {
          id: feeRow.id,
          feeType: feeRow.fee_type,
          feeName: feeRow.fee_name ?? feeRow.fee_type,
          amount: Number(feeRow.amount),
          lateFeeAmount: Number(feeRow.late_fee_amount ?? 0),
          dueDate: feeRow.due_date,
          paidDate: feeRow.paid_date ?? null,
          status: feeRow.status,
          academicYear: feeRow.academic_year ?? null,
          notes: feeRow.notes ?? null,
          // Source: fee_records.breakdown_snapshot (JSONB, immutable, frozen at invoice creation).
          // NEVER reads fee_structures.breakdown — that is live config and may have changed.
          // The pg driver returns JSONB columns as parsed JS values; no JSON.parse needed.
          // Defensive fallback: return [] for null/undefined/non-array (pre-migration rows are []).
          breakdown: Array.isArray(feeRow.breakdown_snapshot) ? feeRow.breakdown_snapshot : [],
        },
        payments: payRows.map(mapPayment),
        payment: payRows.length > 0 ? mapPayment(payRows[0]) : null,
        student: {
          name: feeRow.student_name,
          digitalStudentId: feeRow.digital_student_id,
          class: feeRow.class,
          section: feeRow.section,
          rollNumber: feeRow.roll_number ?? null,
          guardianName: feeRow.guardian_name ?? null,
          phone: feeRow.phone ?? null,
          email: feeRow.student_email ?? null,
        },
        auditEntries: auditRows.map((a: any) => ({
          id: a.id,
          action: a.action,
          actorName: a.actor_name ?? null,
          actorId: a.actor_id ?? null,
          ipAddress: a.ip_address ?? null,
          description: a.description ?? null,
          createdAt: a.created_at,
        })),
      });
    } catch (err) {
      console.error("[transaction-detail]", err);
      res.status(500).json({ message: String(err) });
    }
  });

  // ── Transaction Detail PDF (printable HTML) ───────────────────────────────
  app.get("/api/admin/fees/:id/transaction-pdf", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const feeRecordId = parseInt(req.params.id);
    if (isNaN(feeRecordId)) return res.status(400).json({ message: "Invalid ID" });

    try {
      const feeRow = (await db.execute(sql`
        SELECT fr.*,
               s.name AS student_name, s.digital_student_id, s.class, s.section,
               s.roll_number, s.guardian_name, s.phone
        FROM fee_records fr
        JOIN students s ON s.id = fr.student_id
        WHERE fr.id = ${feeRecordId} AND fr.school_id = ${schoolId}
        LIMIT 1
      `)).rows[0] as any;
      if (!feeRow) return res.status(404).send("Not found");

      const payRows = (await db.execute(sql`
        SELECT * FROM payment_records
        WHERE fee_record_id = ${feeRecordId}
        ORDER BY created_at ASC
      `)).rows as any[];
      const payRow = payRows[payRows.length - 1] ?? null; // most-recent for backward-compat fields

      const auditRows = (await db.execute(sql`
        SELECT * FROM fee_audit_log
        WHERE entity_id = ${feeRecordId} AND entity_type = 'fee_record'
        ORDER BY created_at DESC LIMIT 10
      `)).rows as any[];

      const [school] = await db.select({ name: schools.name }).from(schools).where(eq(schools.id, schoolId));
      const esc = (s: any) =>
        (String(s ?? "—")).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");

      const fmtInr = (n: number) =>
        new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0}).format(n);
      const fmtDt = (d: any) =>
        d ? new Date(d).toLocaleString("en-IN",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",timeZone:"Asia/Kolkata"}) : "—";

      const modeLabel: Record<string,string> = {
        upi:"UPI",card:"Card",netbanking:"Net Banking",wallet:"Wallet",emi:"EMI",
      };

      // Build payment detail rows for each payment record
      const paymentSections = payRows.length === 0
        ? `<tr><td colspan="2" class="na">No payment records for this fee.</td></tr>`
        : payRows.map((pr: any, idx: number) => {
            const isOn = pr.payment_method === "Online";
            return `
            <tr style="background:#f8fafc;">
              <td colspan="2" style="font-weight:700;color:#0891b2;font-size:12px;border-top:2px solid #e2e8f0;">
                Payment ${payRows.length > 1 ? `#${idx+1} of ${payRows.length}` : ""} — ${esc(pr.payment_method)} — ${fmtInr(Number(pr.amount))}
                <span style="float:right;color:#64748b;font-weight:400;">${fmtDt(pr.received_date ?? pr.created_at)}</span>
              </td>
            </tr>
            ${isOn ? `
            <tr><td>Razorpay Payment ID</td><td>${esc(pr.razorpay_payment_id ?? "—")}</td></tr>
            <tr><td>Razorpay Order ID</td><td>${esc(pr.razorpay_order_id ?? "—")}</td></tr>
            <tr><td>Payment Mode</td><td>${esc(modeLabel[pr.payment_mode] ?? pr.payment_mode ?? "—")}</td></tr>
            ${pr.bank_name ? `<tr><td>Bank</td><td>${esc(pr.bank_name)}</td></tr>` : ""}
            ${pr.card_last4 ? `<tr><td>Card (last 4)</td><td>●●●● ${esc(pr.card_last4)}</td></tr>` : ""}
            ${pr.vpa ? `<tr><td>UPI VPA</td><td>${esc(pr.vpa)}</td></tr>` : ""}
            <tr><td>Payer Name</td><td>${esc(pr.payer_name ?? "—")}</td></tr>
            <tr><td>Payer Email</td><td>${esc(pr.payer_email ?? "—")}</td></tr>
            <tr><td>Payer Contact</td><td>${esc(pr.payer_contact ?? "—")}</td></tr>
            <tr><td>Gateway Status</td><td><span class="badge badge-green">${esc(pr.gateway_status ?? "captured")}</span></td></tr>
            <tr><td>HMAC Signature</td><td style="font-size:10px;word-break:break-all;">${esc(pr.razorpay_signature ?? "—")}</td></tr>
            ` : `
            <tr><td>Reference No.</td><td>${esc(pr.reference_number ?? "—")}</td></tr>
            `}
            <tr><td>Receipt No.</td><td>${esc(pr.receipt_number ?? "—")}</td></tr>
            ${pr.cashier_notes ? `<tr><td>Admin Notes</td><td>${esc(pr.cashier_notes)}</td></tr>` : ""}
            `;
          }).join("");

      const totalReceived = payRows.reduce((s: number, pr: any) => s + Number(pr.amount), 0);

      const html = `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><title>Transaction Detail — ${esc(feeRow.fee_type)}</title>
<style>
body{font-family:Arial,sans-serif;margin:0;padding:24px;color:#1e293b;background:#fff;font-size:13px;}
h1{margin:0 0 4px;font-size:18px;color:#0891b2;}
.subtitle{color:#64748b;font-size:12px;margin-bottom:20px;}
.section{margin-bottom:18px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;}
.section-title{background:#f8fafc;border-bottom:1px solid #e2e8f0;padding:8px 14px;font-weight:700;font-size:12px;color:#475569;text-transform:uppercase;letter-spacing:.05em;}
table{width:100%;border-collapse:collapse;}
td{padding:7px 14px;font-size:13px;border-bottom:1px solid #f1f5f9;vertical-align:top;}
td:first-child{color:#64748b;width:38%;font-size:12px;}
td:last-child{font-weight:600;word-break:break-all;}
.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;}
.badge-green{background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0;}
.badge-blue{background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;}
.badge-amber{background:#fffbeb;color:#92400e;border:1px solid #fde68a;}
.na{color:#94a3b8;font-style:italic;font-weight:400;}
.footer{margin-top:24px;text-align:center;font-size:11px;color:#94a3b8;}
@media print{button{display:none;}body{padding:12px;}}
</style></head><body>
<h1>${esc(school?.name ?? "School")} — Transaction Detail</h1>
<p class="subtitle">Fee Record #${feeRecordId} &nbsp;·&nbsp; Generated ${new Date().toLocaleString("en-IN",{timeZone:"Asia/Kolkata"})}</p>

<div class="section">
  <div class="section-title">1. Payment Records (${payRows.length} transaction${payRows.length !== 1 ? "s" : ""})</div>
  <table>${paymentSections}</table>
</div>

<div class="section">
  <div class="section-title">2. Financial &amp; Fee Breakdown</div>
  <table>
    <tr><td>Fee Name / Type</td><td>${esc(feeRow.fee_name ?? feeRow.fee_type)}</td></tr>
    <tr><td>Base Fee</td><td>${fmtInr(Number(feeRow.amount))}</td></tr>
    <tr><td>Late Fee</td><td>${Number(feeRow.late_fee_amount ?? 0) > 0 ? fmtInr(Number(feeRow.late_fee_amount)) : "—"}</td></tr>
    <tr><td>Total Charged</td><td>${fmtInr(Number(feeRow.amount) + Number(feeRow.late_fee_amount ?? 0))}</td></tr>
    <tr><td>Total Received (${payRows.length} payment${payRows.length !== 1 ? "s" : ""})</td><td>${fmtInr(totalReceived)}</td></tr>
    <tr><td>Invoice No.</td><td>${esc(feeRow.invoice_number ?? "—")}</td></tr>
    <tr><td>Receipt No.</td><td>${esc(feeRow.receipt_number ?? payRow?.receipt_number ?? "—")}</td></tr>
    <tr><td>Status</td><td>${esc(feeRow.status)}</td></tr>
    <tr><td>Due Date</td><td>${fmtDt(feeRow.due_date)}</td></tr>
    ${feeRow.paid_date ? `<tr><td>Paid On</td><td>${fmtDt(feeRow.paid_date)}</td></tr>` : ""}
    <tr><td colspan="2" class="na" style="font-size:11px;">Convenience fee / GST / settlement batch — N/A (requires Razorpay Settlements API)</td></tr>
  </table>
</div>

<div class="section">
  <div class="section-title">3. Student &amp; Academic Profile</div>
  <table>
    <tr><td>Student Name</td><td>${esc(feeRow.student_name)}</td></tr>
    <tr><td>DSID</td><td>${esc(feeRow.digital_student_id)}</td></tr>
    <tr><td>Class / Section</td><td>${esc(feeRow.class)} / ${esc(feeRow.section)}</td></tr>
    ${feeRow.roll_number ? `<tr><td>Roll No.</td><td>${esc(feeRow.roll_number)}</td></tr>` : ""}
    <tr><td>Academic Year</td><td>${esc(feeRow.academic_year)}</td></tr>
    ${feeRow.guardian_name ? `<tr><td>Guardian</td><td>${esc(feeRow.guardian_name)}</td></tr>` : ""}
    ${feeRow.phone ? `<tr><td>Contact</td><td>${esc(feeRow.phone)}</td></tr>` : ""}
  </table>
</div>

<div class="section">
  <div class="section-title">4. System Audit &amp; Technical Logs</div>
  <table>
    ${payRow ? `<tr><td>Record Created</td><td>${fmtDt(payRow.created_at)} IST</td></tr>` : ""}
    ${payRow?.cashier_notes ? `<tr><td>Admin Notes</td><td>${esc(payRow.cashier_notes)}</td></tr>` : ""}
    ${auditRows.map((a: any) => `
    <tr>
      <td>${fmtDt(a.created_at)}<br><span style="font-size:10px;color:#94a3b8;">${esc(a.ip_address)} · ${esc(a.actor_name ?? "System")}</span></td>
      <td style="font-size:12px;">${esc(a.description)}</td>
    </tr>`).join("")}
  </table>
</div>

<div class="footer">
  <p>Computer-generated transaction record &nbsp;·&nbsp; BENIUS &nbsp;·&nbsp; ${esc(school?.name ?? "School")}</p>
</div>
<script>window.print();</script>
</body></html>`;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Disposition", `inline; filename="txn-detail-${feeRecordId}.html"`);
      res.send(html);
    } catch (err) {
      console.error("[transaction-pdf]", err);
      res.status(500).json({ message: String(err) });
    }
  });

  // ── PATCH cashier notes on a payment record ───────────────────────────────
  app.patch("/api/admin/fees/payments/:id/notes", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const { cashierNotes } = req.body;
    if (typeof cashierNotes !== "string" && cashierNotes !== null)
      return res.status(400).json({ message: "cashierNotes must be string or null" });
    try {
      const result = await db.execute(sql`
        UPDATE payment_records SET cashier_notes = ${cashierNotes ?? null}
        WHERE id = ${id} AND school_id = ${schoolId}
        RETURNING id
      `);
      if ((result.rowCount ?? 0) === 0) return res.status(404).json({ message: "Payment record not found" });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ message: String(err) });
    }
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
    const invoiceNo = esc(row.invoice_number ?? "—");
    const receiptNo = esc(row.receipt_number ?? "—");

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
    <tr><td>Invoice No.</td><td>${invoiceNo}</td></tr>
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

  // ── Student: All payment attempts (paid + failed + cancelled) ───────────
  // Powers the History tab — shows every attempt, not just receipts.
  // Session-scoped: when viewSessionId is set only attempts for that academic
  // session are returned (via fee_records.session_id or the attempt's own
  // session_id column written at INSERT time).
  // ── Payment attempts: reads from the unified payment_attempts table ─────────
  // Historical rows were back-filled from payment_records + fee_audit_log at
  // startup.  All new attempts are written here by the webhook and
  // clear-failed-order handlers.
  app.get("/api/student/fees/payment-attempts", async (req, res) => {
    if (!req.session?.studentId) return res.status(403).json({ message: "Student access required" });
    const student = await storage.getStudentById(req.session.studentId);
    if (!student) return res.status(403).json({ message: "Student not found" });

    const viewSessionId: number | null = (req as any).viewSessionId ?? null;
    const sessionCond = viewSessionId != null
      ? sql`AND COALESCE(pa.session_id, fr.session_id) = ${viewSessionId}`
      : sql``;

    try {
      const rows = await db.execute(sql`
        SELECT
          pa.id,

          -- Backward-compat fields (existing display logic uses these)
          CASE WHEN pa.outcome = 'captured' THEN 'paid' ELSE 'failed' END AS type,
          (pa.outcome = 'cancelled')                                       AS "isCancelled",
          pa.outcome,

          -- Fee info
          pa.fee_record_id                                                 AS "feeRecordId",
          fr.fee_type                                                      AS "feeType",
          fr.fee_type                                                      AS "feeName",

          -- Amount: display rupees for existing logic; raw paise for breakdowns
          COALESCE(pa.amount_paise, fr.amount * 100) / 100                AS amount,
          pa.amount_paise                                                  AS "amountPaise",
          pa.amount_captured_paise                                         AS "amountCapturedPaise",
          pa.amount_refunded_paise                                         AS "amountRefundedPaise",
          pa.razorpay_fee_paise                                            AS "razorpayFeePaise",
          pa.razorpay_tax_paise                                            AS "razorpayTaxPaise",
          COALESCE(pa.currency, 'INR')                                     AS currency,

          -- Dates
          pa.created_at                                                    AS "date",
          COALESCE(pa.receipt_number, pr.receipt_number)                   AS "receiptNumber",

          -- Payment method
          pa.payment_method                                                AS "paymentMethod",
          pa.payment_method                                                AS "paymentMode",
          pa.card_last4                                                    AS "cardLast4",
          pa.card_network                                                  AS "cardNetwork",
          pa.card_type                                                     AS "cardType",
          pa.card_issuer                                                   AS "cardIssuer",
          pa.card_name                                                     AS "cardName",
          pa.card_international                                            AS "cardInternational",
          pa.bank_name                                                     AS "bankName",
          pa.bank_rrn                                                      AS "bankRrn",
          pa.bank_auth_code                                                AS "bankAuthCode",
          pa.vpa,
          pa.wallet,

          -- Identifiers
          pa.razorpay_payment_id                                           AS "razorpayPaymentId",
          pa.razorpay_order_id                                             AS "razorpayOrderId",

          -- Customer (payer_email and payer_contact are stored by the server;
          -- client should mask them before display)
          pa.payer_name                                                    AS "payerName",
          pa.payer_email                                                   AS "payerEmail",
          pa.payer_contact                                                 AS "payerContact",

          -- Failure
          pa.error_code                                                    AS "errorCode",
          pa.error_description                                             AS "errorDescription",
          pa.error_source                                                  AS "errorSource",
          pa.error_step                                                    AS "errorStep",
          pa.error_reason                                                  AS "errorReason",

          -- Razorpay lifecycle timestamps (from API; returned as ISO strings)
          pa.rzp_created_at                                                AS "rzpCreatedAt",
          pa.rzp_authorized_at                                             AS "rzpAuthorizedAt",
          pa.rzp_captured_at                                               AS "rzpCapturedAt",
          pa.rzp_failed_at                                                 AS "rzpFailedAt",

          -- Refund
          pa.refund_id                                                     AS "refundId",
          pa.refund_status                                                 AS "refundStatus",
          pa.refund_amount_paise                                           AS "refundAmountPaise",
          pa.refund_initiated_at                                           AS "refundInitiatedAt",
          pa.refund_processed_at                                           AS "refundProcessedAt",

          pa.api_synced_at                                                 AS "apiSyncedAt",
          pa.created_at                                                    AS "createdAt",

          -- JSONB-extracted enrichment (no extra DB columns needed)
          pa.razorpay_payment_data->'card'->>'id'                           AS "cardId",
          pa.razorpay_payment_data->>'fee_bearer'                           AS "feeBearer",
          COALESCE(
            pa.razorpay_order_data->>'description',
            pa.razorpay_payment_data->>'description'
          )                                                                  AS description,
          pa.razorpay_payment_data->'acquirer_data'->>'bank_transaction_id' AS "bankTransactionId",
          pa.razorpay_payment_data->>'arn'                                  AS "refundArn",
          pa.razorpay_order_data->'notes'                                   AS "orderNotes",

          -- Sequential attempt number per fee record (1 = oldest, n = newest)
          (ROW_NUMBER() OVER (
            PARTITION BY COALESCE(pa.fee_record_id, pa.id)
            ORDER BY pa.created_at ASC
          ))::integer                                                        AS "attemptNumber"

        FROM payment_attempts pa
        LEFT JOIN fee_records fr     ON fr.id = pa.fee_record_id
        -- Pull receipt_number from payment_records as a fallback for migrated rows
        LEFT JOIN payment_records pr ON  pr.school_id          = pa.school_id
                                     AND pr.fee_record_id      = pa.fee_record_id
                                     AND pr.razorpay_payment_id = pa.razorpay_payment_id
                                     AND pa.razorpay_payment_id IS NOT NULL

        WHERE pa.school_id  = ${student.schoolId}
          AND (
            pa.student_id = ${student.id}
            OR (pa.student_id IS NULL AND fr.student_id = ${student.id})
          )
          ${sessionCond}

        ORDER BY pa.created_at DESC
        LIMIT 400
      `);

      res.json(rows.rows);
    } catch (err: any) {
      console.error("[/api/student/fees/payment-attempts]", err);
      res.status(500).json({ message: "Failed to load payment history" });
    }
  });

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
