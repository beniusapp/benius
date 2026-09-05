import type { Express } from "express";
import { storage } from "./storage";
import { requireStudentFeeSession } from "./student-fee-session-context";
import { db } from "./db";
import { calculateLateFee, recalculateLateFees, DEFAULT_LATE_FEE_CONFIG, type LateFeeConfig } from "./late-fee-engine";
import { users, schools, students, feeRecords, paymentRecords, notificationConfig, dunningLog, dunningTemplates, externalPaymentSettings, feeStructures, dunningJobStatus, academicSessions } from "@shared/schema";
import { and, eq, sql, desc, or, isNotNull } from "drizzle-orm";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import Razorpay from "razorpay";
import { broadcastPaymentUpdate } from "./sse";
import {
  fetchRazorpayData,
  mapRazorpayPayment,
  razorpayEpochToDate,
  razorpayPaymentBusinessDateIST,
  razorpayPaymentCapturedAt,
  razorpayPaymentCreatedAt,
  upsertPaymentAttempt,
} from "./rzp-enrichment";
import {
  appendPaymentAttemptEvent,
  recordWebhookDelivery,
  sanitizePaymentPayload,
  updateAttemptEnrichmentState,
  updateWebhookDelivery,
  webhookProviderEventId,
} from "./payment-attempt-history";
import { validateCapturedRazorpayPayment } from "./razorpay-verify-guard";
import { getMultiInvoiceOfflinePaymentError } from "./offline-payment-request-guard";
import { formatOfflinePaymentMethod } from "@shared/offline-payment-method";
import { isPortalPayment, normalizePaymentMethod } from "@shared/payment-method";
import {
  isValidOfflineCorrectionDate,
  normalizeOptionalOfflineCorrectionDate,
  offlinePaymentDetailRows,
} from "@shared/offline-payment-details";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import sharp from "sharp";
import {
  InvoiceGenerationError,
  buildInvoiceDuplicateIndex,
  createStructureInvoice,
  isStudentEligibleForStructure,
  prepareStructureInvoiceContext,
} from "./structure-invoice-service";
import { formatPersistedDateTimeIST } from "./persisted-date-time";
import { renderInvoiceDocument } from "./invoice-document";
import { formatDateOnly, formatInstantIST, todayInIST } from "@shared/ist-time";
import { renderReceiptHtml, type ReceiptData } from "./receipt-renderer";
import { renderInvoicePdf } from "./invoice-pdf";
import {
  buildFinancialAnalytics,
  isValidDate,
  daysBetween,
  todayIST,
  type FinancialPreset,
} from "./financial-analytics-data";
import {
  renderFinancialAnalyticsPdf,
  type ReportSection,
} from "./financial-analytics-pdf";

import { renderLedgerPdf, type LedgerRow } from "./ledger-pdf";
import { renderTransactionPdf } from "./transaction-pdf";
import { loadTransactionDetailData } from "./transaction-detail-data";
import {
  renderTransactionAuditHtml,
  type TransactionAuditDetail,
} from "./transaction-audit-report";
import {
  buildTransactionRows,
  type TxSelectionParams,
} from "./transaction-report-data";
import {
  getRefundEligibility,
  markRefundReconciliationRequired,
  markRefundProviderFailure,
  recordRefundApiSubmission,
  reconcileRefundWebhook,
  REFUND_REASON_CODES,
  reserveRefundRequest,
  type RefundReasonCode,
} from "./refund-service";
import {
  normalizeLedgerFiltersFromQuery,
  normalizeLedgerFiltersFromBody,
  firstLedgerFilterValue,
  joinedLedgerFilterLabel,
} from "@shared/ledger-filters";
import {
  buildLedgerFilterPredicates,
  buildLedgerInvoiceSessionPredicate,
  buildLedgerPaymentDatePredicate,
  type LedgerFilterFields,
} from "./ledger-filter-sql";
import { feePeriodLabel } from "./fee-period";
import {
  appendFeeAudit,
  describeFeeAuditChanges,
  isCurrentFeeAuditAction,
  RAZORPAY_FEE_AUDIT_ACTOR,
  requestIpAddress,
  resolveFeeAuditActor,
  SYSTEM_FEE_AUDIT_ACTOR,
  validateFeeAuditDateRange,
} from "./fee-audit";

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
  | { ok: false; status: 400 | 403 | 404; message: string };

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
  let historyContext: { studentId: number; sessionId: number | null; orderId: string; amountPaise: number } | null = null;

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
       SELECT id, student_id, session_id, status, amount, late_fee_amount, due_date, fee_type, late_fee_config,
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
    const activeSession = await tx.execute(sql`
      SELECT 1
      FROM academic_sessions
      WHERE id = ${locked.session_id}
        AND school_id = ${schoolId}
        AND is_active = true
      LIMIT 1
    `);
    if (activeSession.rows.length === 0) {
      result = {
        ok: false,
        status: 403,
        message: "Archived or unassigned academic-session invoices cannot be paid.",
      };
      return;
    }

    // Re-check payable status under lock — a concurrent webhook may have just
    // marked this fee Paid between the pre-flight read and now.
    if (!["Due", "Overdue"].includes(locked.status)) {
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
    const lateFeeConfig = (locked.late_fee_config as LateFeeConfig | null) ?? lateFeeConfigMap.get(
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
    historyContext = {
      studentId: Number(locked.student_id),
      sessionId: locked.session_id == null ? null : Number(locked.session_id),
      orderId: order.id,
      amountPaise,
    };
  });

  // TypeScript does not track assignments made inside the async transaction
  // callback, although they are complete once `await db.transaction()` returns.
  const completedResult = result as unknown as AcquireOrderResult;
  const completedHistory = historyContext as unknown as {
    studentId: number; sessionId: number | null; orderId: string; amountPaise: number;
  } | null;
  if (completedResult.ok && completedHistory) {
    try {
      const attemptId = await upsertPaymentAttempt({
        schoolId,
        studentId: completedHistory.studentId,
        feeRecordId,
        sessionId: completedHistory.sessionId,
        outcome: "pending",
        razorpayOrderId: completedHistory.orderId,
        amountPaise: completedHistory.amountPaise,
        currency: "INR",
        source: "client",
      });
      await appendPaymentAttemptEvent({
        schoolId,
        paymentAttemptId: attemptId,
        studentId: completedHistory.studentId,
        feeRecordId,
        sessionId: completedHistory.sessionId,
        eventType: "checkout_initiated",
        outcome: "pending",
        razorpayOrderId: completedHistory.orderId,
        amountPaise: completedHistory.amountPaise,
        source: "client",
        idempotencyKey: `checkout-init:${completedHistory.orderId}`,
        payload: { checkoutExpiresAt: new Date(Date.now() + CHECKOUT_TIMEOUT_SECONDS * 1_000).toISOString() },
        occurredAt: new Date(),
      });
    } catch (historyErr) {
      // An order remains usable if the diagnostic mirror is unavailable; never
      // create a second charge merely because auditing is temporarily degraded.
      console.error("[razorpay create-order] attempt history write failed:", historyErr);
    }
  }
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

  /**
   * Resolve the selected financial session only when it belongs to the
   * authenticated school. A client-supplied session header is never a scope
   * authority on its own. Returning null means this school has no selected or
   * active session; callers must return an empty financial result rather than
   * silently falling back to all historical years.
   */
  async function resolveFeeViewSession(
    req: any,
    res: any,
    schoolId: number,
  ): Promise<number | null | undefined> {
    const requestedId = (req as any).viewSessionId ?? (await storage.getActiveSession(schoolId))?.id ?? null;
    if (requestedId == null) return null;
    const selected = await storage.getAcademicSessionById(Number(requestedId));
    if (!selected || selected.schoolId !== schoolId) {
      res.status(404).json({ message: "Selected academic session not found for this school." });
      return undefined;
    }
    return selected.id;
  }

  async function activeFinancialSessionGuard(
    res: any,
    schoolId: number,
    sessionId: number | null | undefined,
  ): Promise<boolean> {
    if (sessionId == null) {
      res.status(409).json({ message: "This financial record has no academic-session ownership and is read-only." });
      return false;
    }
    const [session] = await db.select({ id: academicSessions.id })
      .from(academicSessions)
      .where(and(
        eq(academicSessions.id, Number(sessionId)),
        eq(academicSessions.schoolId, schoolId),
        eq(academicSessions.isActive, true),
      ));
    if (!session) {
      res.status(403).json({
        message: "Archived academic-session financial records are read-only.",
        code: "ARCHIVE_READ_ONLY",
      });
      return false;
    }
    return true;
  }

  async function activePaymentRecordGuard(
    res: any,
    schoolId: number,
    paymentRecordId: number,
  ): Promise<boolean> {
    const [payment] = await db.select({ sessionId: paymentRecords.sessionId })
      .from(paymentRecords)
      .where(and(
        eq(paymentRecords.id, paymentRecordId),
        eq(paymentRecords.schoolId, schoolId),
      ));
    if (!payment) {
      res.status(404).json({ message: "Payment record not found." });
      return false;
    }
    return activeFinancialSessionGuard(res, schoolId, payment.sessionId);
  }

  const EXTERNAL_PORTAL_REAUTH_TTL_MS = Math.min(
    Math.max(Number(process.env.EXTERNAL_PORTAL_REAUTH_TTL_MS) || 10 * 60 * 1000, 60_000),
    30 * 60 * 1000,
  );

  function clearExternalPortalReauth(req: any) {
    delete (req.session as any).externalPortalReauth;
  }

  async function externalPortalGuard(req: any, res: any): Promise<boolean> {
    if (!adminGuard(req, res)) return false;

    const sessionUserId = req.session.userId as number;
    const sessionSchoolId = req.session.schoolId as number;
    const admin = await storage.getUserById(sessionUserId);
    const approval = (req.session as any).externalPortalReauth as
      | { userId: number; schoolId: number; verifiedAt: number }
      | undefined;
    const isValid =
      !!admin &&
      admin.isActive &&
      admin.role === "admin" &&
      admin.schoolId === sessionSchoolId &&
      !!approval &&
      approval.userId === sessionUserId &&
      approval.schoolId === sessionSchoolId &&
      Number.isFinite(approval.verifiedAt) &&
      Date.now() - approval.verifiedAt >= 0 &&
      Date.now() - approval.verifiedAt < EXTERNAL_PORTAL_REAUTH_TTL_MS;

    if (!isValid) {
      clearExternalPortalReauth(req);
      return res.status(403).json({
        message: "Admin verification is required to access External Payment Portal settings.",
        code: "EXTERNAL_PORTAL_REAUTH_REQUIRED",
      }), false;
    }

    return true;
  }

  async function refundGuard(req: any, res: any): Promise<boolean> {
    if (!adminGuard(req, res)) return false;
    const [user] = await db.select({ canRefund: users.canRefund, schoolId: users.schoolId })
      .from(users)
      .where(and(eq(users.id, req.session.userId), eq(users.schoolId, req.session.schoolId)));
    if (!user?.canRefund) {
      res.status(403).json({ message: "You do not have permission to initiate refunds." });
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
    const actor = await resolveFeeAuditActor(req, schoolId);
    const studentResult = studentId
      ? await db.select({ name: students.name }).from(students).where(and(
          eq(students.id, studentId),
          eq(students.schoolId, schoolId),
        ))
      : [];
    const entityResult = entityType === "fee_record" && entityId
      ? await db.select({
          invoiceNumber: feeRecords.invoiceNumber,
          feeType: feeRecords.feeType,
          sessionId: feeRecords.sessionId,
          amount: feeRecords.amount,
        }).from(feeRecords).where(and(
          eq(feeRecords.id, entityId),
          eq(feeRecords.schoolId, schoolId),
        ))
      : [];
    const entity = entityResult[0];
    await appendFeeAudit({
      schoolId,
      actor,
      action,
      entityType,
      entityId,
      studentId: studentId ?? null,
      studentName: studentResult[0]?.name ?? null,
      sessionId: entity?.sessionId ?? (req as any).viewSessionId ?? null,
      recordLabel: entity?.invoiceNumber ?? (entity?.feeType ? `${entity.feeType} invoice` : null),
      amount: entity?.amount ?? null,
      description,
      ipAddress: requestIpAddress(req),
    });
  }

  async function upsertExternalSettingsWithAudit(
    req: any,
    schoolId: number,
    data: Parameters<typeof storage.upsertExternalPaymentSettings>[1],
    entityType: string,
    description: string,
  ) {
    const actor = await resolveFeeAuditActor(req, schoolId);
    return db.transaction(async tx => {
      const updated = await storage.upsertExternalPaymentSettings(schoolId, data, tx);
      await appendFeeAudit({
        schoolId,
        actor,
        action: "settings_change",
        entityType,
        entityId: null,
        recordLabel: "Fees & Payments settings",
        description: description || "Fees & Payments settings saved.",
        ipAddress: requestIpAddress(req),
      }, tx);
      return updated;
    });
  }

  // ── GET /api/admin/fees/summary ───────────────────────────────────────────
  app.get("/api/admin/fees/summary", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const actor = await resolveFeeAuditActor(req, schoolId);
    const sessionFilter = await resolveFeeViewSession(req, res, schoolId);
    if (sessionFilter === undefined) return;
    if (sessionFilter === null) {
      return res.json({ totalRevenue: 0, outstanding: 0, collectionRate: 0, offlinePaymentsCount: 0 });
    }
    const summary = await storage.getFeeSummary(schoolId, sessionFilter);
    res.json(summary);
  });

  // ── Financial Analytics — canonical service integration ──────────────────
  // Preset + custom-range query validation shared by the JSON and PDF routes.
  const ANALYTICS_PRESETS: readonly FinancialPreset[] = [
    "today", "this_week", "this_month", "academic_year", "custom",
  ] as const;

  /** A single scalar query param, or null if absent. Arrays are rejected. */
  function scalarQueryParam(value: unknown): string | null | undefined {
    if (value === undefined || value === null) return null;
    if (Array.isArray(value)) return undefined; // signal "reject: array"
    if (typeof value !== "string") return undefined; // reject non-scalar
    return value;
  }

  /**
   * Validates the analytics request: resolves the school + selected session and
   * parses/validates the preset and custom date range. Returns either a
   * `{ ok: true, ... }` payload of validated build inputs, or `{ ok: false }`
   * with a status/message the caller should send. Date params on non-custom
   * presets are ignored (not rejected).
   */
  async function resolveAnalyticsRequest(req: any): Promise<
    | { ok: true; schoolId: number; sessionId: number; preset: FinancialPreset; customStart?: string; customEnd?: string }
    | { ok: false; status: number; message: string }
  > {
    const schoolId = req.session.schoolId as number;
    const viewSessionId: number | null = req.viewSessionId ?? null;
    const sessionId = viewSessionId ?? (await storage.getActiveSession(schoolId))?.id ?? null;
    if (!sessionId) {
      return { ok: false, status: 409, message: "No academic session selected or active. Select a session before viewing financial analytics." };
    }

    const rawPreset = req.query.preset;
    if (Array.isArray(rawPreset)) {
      return { ok: false, status: 400, message: "preset must be a single value." };
    }
    const preset: FinancialPreset = rawPreset === undefined || rawPreset === null || rawPreset === ""
      ? "academic_year"
      : (rawPreset as FinancialPreset);
    if (!ANALYTICS_PRESETS.includes(preset)) {
      return { ok: false, status: 400, message: `preset must be one of: ${ANALYTICS_PRESETS.join(", ")}.` };
    }

    if (preset !== "custom") {
      // Date params are ignored on non-custom presets.
      return { ok: true, schoolId, sessionId, preset };
    }

    const startDate = scalarQueryParam(req.query.startDate);
    const endDate = scalarQueryParam(req.query.endDate);
    if (startDate === undefined || endDate === undefined) {
      return { ok: false, status: 400, message: "startDate and endDate must be single YYYY-MM-DD values." };
    }
    if (!startDate || !endDate) {
      return { ok: false, status: 400, message: "startDate and endDate are required for the custom preset." };
    }
    if (!isValidDate(startDate) || !isValidDate(endDate)) {
      return { ok: false, status: 400, message: "startDate and endDate must be valid YYYY-MM-DD calendar dates." };
    }
    if (startDate > endDate) {
      return { ok: false, status: 400, message: "startDate must be on or before endDate." };
    }
    return { ok: true, schoolId, sessionId, preset, customStart: startDate, customEnd: endDate };
  }

  /**
   * Maps a buildFinancialAnalytics error to an HTTP status. Session ownership
   * misses → 404; known filter/date validation → 400; everything else → 500
   * (logged server-side, sanitized to the client).
   */
  function analyticsErrorResponse(err: any, res: any): void {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not found for school/i.test(msg)) {
      res.status(404).json({ message: "Selected session not found for this school." });
      return;
    }
    if (
      /required for custom preset/i.test(msg) ||
      /Invalid date format/i.test(msg) ||
      /must be <=/i.test(msg) ||
      /may not exceed 5 years/i.test(msg)
    ) {
      res.status(400).json({ message: msg });
      return;
    }
    console.error("[fees/analytics]", err);
    res.status(500).json({ message: "Failed to build financial analytics." });
  }

  // ── GET /api/fees/analytics ──────────────────────────────────────────────
  app.get("/api/fees/analytics", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const resolved = await resolveAnalyticsRequest(req);
    if (!resolved.ok) {
      return res.status(resolved.status).json({ message: resolved.message });
    }
    try {
      const data = await buildFinancialAnalytics({
        schoolId: resolved.schoolId,
        sessionId: resolved.sessionId,
        preset: resolved.preset,
        customStart: resolved.customStart,
        customEnd: resolved.customEnd,
      });
      res.setHeader("Cache-Control", "no-store");
      res.json(data);
    } catch (err: any) {
      analyticsErrorResponse(err, res);
    }
  });

  // ── GET /api/fees/analytics/pdf ──────────────────────────────────────────
  const ANALYTICS_SECTIONS: readonly ReportSection[] = [
    "complete", "summary", "trend", "channels", "classes", "categories", "aging", "cash",
  ] as const;

  app.get("/api/fees/analytics/pdf", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const resolved = await resolveAnalyticsRequest(req);
    if (!resolved.ok) {
      return res.status(resolved.status).json({ message: resolved.message });
    }

    const rawSection = req.query.section;
    if (Array.isArray(rawSection)) {
      return res.status(400).json({ message: "section must be a single value." });
    }
    const section: ReportSection = rawSection === undefined || rawSection === null || rawSection === ""
      ? "complete"
      : (rawSection as ReportSection);
    if (!ANALYTICS_SECTIONS.includes(section)) {
      return res.status(400).json({ message: `section must be one of: ${ANALYTICS_SECTIONS.join(", ")}.` });
    }

    try {
      const data = await buildFinancialAnalytics({
        schoolId: resolved.schoolId,
        sessionId: resolved.sessionId,
        preset: resolved.preset,
        customStart: resolved.customStart,
        customEnd: resolved.customEnd,
      });

      // Tenant-scoped school name lookup.
      const [schoolRow] = await db
        .select({ name: schools.name })
        .from(schools)
        .where(eq(schools.id, resolved.schoolId))
        .limit(1);
      const schoolName = schoolRow?.name ?? "School";

      const pdf = await renderFinancialAnalyticsPdf({
        data,
        school: { name: schoolName },
        section,
      });

      const safeSlug = (s: string) => s.replace(/[^0-9A-Za-z._-]+/g, "_");
      const filename = `financial-analytics-${safeSlug(data.filter.startDate)}-${safeSlug(data.filter.endDate)}-${safeSlug(section)}.pdf`;

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(pdf);
    } catch (err: any) {
      analyticsErrorResponse(err, res);
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
    const schoolId = req.session.schoolId!;
    const structures = await storage.getFeeStructuresBySchool(schoolId);

    // Fee records carry the immutable period selected when each invoice was
    // generated. Read the newest period per fee type for the display cards.
    const latestPeriods = await db.select({
      feeType: feeRecords.feeType,
      feePeriodStart: feeRecords.feePeriodStart,
      feePeriodEnd: feeRecords.feePeriodEnd,
    }).from(feeRecords)
      .where(and(
        eq(feeRecords.schoolId, schoolId),
        isNotNull(feeRecords.invoiceNumber),
        isNotNull(feeRecords.feePeriodStart),
        isNotNull(feeRecords.feePeriodEnd),
      ))
      .orderBy(desc(feeRecords.feePeriodStart), desc(feeRecords.createdAt));

    const latestPeriodByFeeType = new Map<string, {
      feePeriodStart: string;
      feePeriodEnd: string;
    }>();
    for (const period of latestPeriods) {
      if (!latestPeriodByFeeType.has(period.feeType) && period.feePeriodStart && period.feePeriodEnd) {
        latestPeriodByFeeType.set(period.feeType, {
          feePeriodStart: String(period.feePeriodStart),
          feePeriodEnd: String(period.feePeriodEnd),
        });
      }
    }

    res.json(structures.map(structure => {
      const latest = latestPeriodByFeeType.get(structure.feeType);
      return {
        ...structure,
        latestGeneratedFeePeriodStart: latest?.feePeriodStart ?? null,
        latestGeneratedFeePeriodEnd: latest?.feePeriodEnd ?? null,
      };
    }));
  });

  app.post("/api/admin/fees/structures", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const parsed = structureBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    const schoolId = req.session.schoolId!;
    const actor = await resolveFeeAuditActor(req, schoolId);
    const rec = await db.transaction(async tx => {
      const created = await storage.createFeeStructure(
        { ...parsed.data, schoolId, createdBy: req.session.userId },
        tx,
      );
      await appendFeeAudit({
        schoolId,
        actor,
        action: "create",
        entityType: "fee_structure",
        entityId: created.id,
        recordLabel: created.name,
        amount: created.amount,
        description: `Created fee structure "${created.name}" for ₹${Number(created.amount).toLocaleString("en-IN")} (${created.frequency}).`,
        ipAddress: requestIpAddress(req),
      }, tx);
      return created;
    });
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

    const actor = await resolveFeeAuditActor(req, schoolId);
    const result = await db.transaction(async tx => {
      const [before] = await tx.select().from(feeStructures).where(and(
        eq(feeStructures.id, id),
        eq(feeStructures.schoolId, schoolId),
      ));
      if (!before) return null;
      const updated = await storage.updateFeeStructure(id, schoolId, parsed.data, tx);
      if (!updated) return null;
      const [activeSession] = await tx.select({ id: academicSessions.id })
        .from(academicSessions)
        .where(and(
          eq(academicSessions.schoolId, schoolId),
          eq(academicSessions.isActive, true),
        ))
        .limit(1);
      const activeSessionId = activeSession?.id ?? null;

      const amountChanged = parsed.data.amount !== undefined && parsed.data.amount !== before.amount;
      const feeTypeChanged = parsed.data.feeType !== undefined && parsed.data.feeType !== before.feeType;
      const dueDayChanged = parsed.data.dueDayOfMonth !== undefined
        && parsed.data.dueDayOfMonth !== null
        && parsed.data.dueDayOfMonth !== before.dueDayOfMonth;
      let syncedCount = 0;
      if (activeSessionId != null && (amountChanged || feeTypeChanged)) {
        const patch: Record<string, unknown> = {};
        if (amountChanged) patch.amount = parsed.data.amount;
        if (feeTypeChanged) patch.feeType = parsed.data.feeType;
        const synced = await tx.update(feeRecords).set(patch as any).where(and(
          eq(feeRecords.schoolId, schoolId),
          eq(feeRecords.sessionId, activeSessionId),
          eq(feeRecords.feeType, before.feeType),
          or(eq(feeRecords.status, "Due"), eq(feeRecords.status, "Overdue")),
        )).returning({ id: feeRecords.id });
        syncedCount = synced.length;
      }
      if (activeSessionId != null && dueDayChanged) {
        const newDay = parsed.data.dueDayOfMonth!;
        const matchFeeType = feeTypeChanged ? parsed.data.feeType! : before.feeType;
        const dueDateResult = await tx.execute(sql`
          UPDATE fee_records
          SET due_date = MAKE_DATE(
            EXTRACT(YEAR FROM due_date)::int,
            EXTRACT(MONTH FROM due_date)::int,
            LEAST(
              ${newDay}::int,
              EXTRACT(DAY FROM (DATE_TRUNC('month', due_date) + INTERVAL '1 month' - INTERVAL '1 day'))::int
            )
          )
          WHERE school_id = ${schoolId}
            AND session_id = ${activeSessionId}
            AND fee_type = ${matchFeeType}
            AND status IN ('Due', 'Overdue')
          RETURNING id
        `);
        if (!amountChanged && !feeTypeChanged) syncedCount = dueDateResult.rows.length;
      }

      let voidedCount = 0;
      const newClasses: string[] | undefined = parsed.data.applicableClasses;
      if (activeSessionId != null && newClasses !== undefined && newClasses.length > 0) {
        const matchFeeType = feeTypeChanged ? parsed.data.feeType! : before.feeType;
        const unpaidRecs = await tx.select({
          id: feeRecords.id,
          studentId: feeRecords.studentId,
          invoiceNumber: feeRecords.invoiceNumber,
          feeType: feeRecords.feeType,
          amount: feeRecords.amount,
          sessionId: feeRecords.sessionId,
        })
          .from(feeRecords).where(and(
            eq(feeRecords.schoolId, schoolId),
            eq(feeRecords.sessionId, activeSessionId),
            eq(feeRecords.feeType, matchFeeType),
            or(eq(feeRecords.status, "Due"), eq(feeRecords.status, "Overdue")),
          ));
        if (unpaidRecs.length > 0) {
          const schoolStudents = await tx.select({ id: students.id, class: students.class, name: students.name })
            .from(students).where(eq(students.schoolId, schoolId));
          const classMap = new Map(schoolStudents.map(student => [student.id, student.class]));
          const studentNameMap = new Map(schoolStudents.map(student => [student.id, student.name]));
          const toVoidRecords = unpaidRecs
            .filter(record => {
              const className = classMap.get(record.studentId);
              return !className || !newClasses.includes(className);
            });
          const toVoidIds = toVoidRecords.map(record => record.id);
          if (toVoidIds.length > 0) {
            const removed = await tx.delete(feeRecords).where(and(
              eq(feeRecords.schoolId, schoolId),
              eq(feeRecords.sessionId, activeSessionId),
              sql`id = ANY(${sql.raw(`ARRAY[${toVoidIds.join(",")}]`)})`,
              or(eq(feeRecords.status, "Due"), eq(feeRecords.status, "Overdue")),
            )).returning({ id: feeRecords.id });
            voidedCount = removed.length;
            const removedIds = new Set(removed.map(record => record.id));
            for (const record of toVoidRecords.filter(candidate => removedIds.has(candidate.id))) {
              const studentName = studentNameMap.get(record.studentId) ?? null;
              await appendFeeAudit({
                schoolId,
                actor,
                action: "delete",
                entityType: "fee_record",
                entityId: record.id,
                studentId: record.studentId,
                studentName,
                sessionId: record.sessionId,
                recordLabel: record.invoiceNumber ?? `${record.feeType} invoice`,
                amount: record.amount,
                description: `Deleted ${record.invoiceNumber ?? "invoice"} for ${studentName ?? "Unknown student"} because it no longer matched fee structure "${updated.name}".`,
                ipAddress: requestIpAddress(req),
              }, tx);
            }
          }
        }
      }
      const changes = describeFeeAuditChanges(before as any, updated as any, {
        name: { label: "name" },
        feeType: { label: "fee type" },
        amount: { label: "amount", format: value => `₹${Number(value ?? 0).toLocaleString("en-IN")}` },
        frequency: { label: "frequency" },
        dueDayOfMonth: { label: "due day" },
        applicableClasses: {
          label: "applicable classes",
          format: value => Array.isArray(value) && value.length ? value.join(", ") : "all classes",
        },
      });
      const impact = [
        syncedCount > 0 ? `${syncedCount} unpaid invoices synchronized` : null,
        voidedCount > 0 ? `${voidedCount} out-of-scope invoices deleted` : null,
      ].filter(Boolean).join("; ");
      await appendFeeAudit({
        schoolId,
        actor,
        action: "update",
        entityType: "fee_structure",
        entityId: id,
        recordLabel: updated.name,
        amount: updated.amount,
        description: `Updated fee structure "${updated.name}"${changes ? `: ${changes}` : ""}${impact ? `. ${impact}` : ""}.`,
        ipAddress: requestIpAddress(req),
      }, tx);
      return { updated, syncedCount, voidedCount, changes: impact ? impact.split("; ") : [] };
    });
    if (!result) return res.status(404).json({ message: "Fee structure not found" });

    // Re-run late fee calculation for this school after any structure change
    recalculateLateFees(schoolId).catch(() => {/* non-critical */});

    res.json({
      ...result.updated,
      syncedInvoices: result.syncedCount,
      voidedInvoices: result.voidedCount,
      syncedFields: result.changes,
    });
  });

  app.delete("/api/admin/fees/structures/:id", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
    const schoolId = req.session.schoolId!;
    const actor = await resolveFeeAuditActor(req, schoolId);
    const deleted = await db.transaction(async tx => {
      const [structure] = await tx.select().from(feeStructures).where(and(
        eq(feeStructures.id, id),
        eq(feeStructures.schoolId, schoolId),
      ));
      if (!structure) return false;
      const removed = await storage.deleteFeeStructure(id, schoolId, tx);
      if (!removed) return false;
      await appendFeeAudit({
        schoolId,
        actor,
        action: "delete",
        entityType: "fee_structure",
        entityId: id,
        recordLabel: structure.name,
        amount: structure.amount,
        description: `Deleted fee structure "${structure.name}" (${structure.feeType}, ₹${Number(structure.amount).toLocaleString("en-IN")}).`,
        ipAddress: requestIpAddress(req),
      }, tx);
      return true;
    });
    if (!deleted) return res.status(404).json({ message: "Fee structure not found" });
    res.json({ success: true });
  });

  // ── Offline Payment Records ───────────────────────────────────────────────

  const paymentBodySchema = z.object({
    // One offline payment always settles one existing invoice.
    feeRecordId: z.number().int().positive(),
    studentId: z.number().int().positive(),
    // Retained as a false-only field so legacy requests fail safely instead of
    // reopening the retired multi-invoice FIFO allocation path.
    autoFifo: z.literal(false).optional().default(false),
    // feeNotes: optional notes written to the linked invoice during payment
    feeNotes: z.string().max(500).optional().nullable(),
    // Payment fields — Online is excluded from manual offline recording
    paymentMethod: z.enum(["Cash", "Cheque", "BankTransfer", "DemandDraft", "UpiQr"]),
    referenceNumber: z.string().max(100).optional().nullable(),
    receivedDate: z.string().min(1),
    amount: z.number().int().positive(),
    cashierNotes: z.string().max(500).optional().nullable(),
    idempotencyKey: z.string().max(64).optional().nullable(),
    lateFeePaid: z.number().int().min(0).default(0),
    // ── Cash denomination fields ──────────────────────────────────────────────
    // denominationBreakdown: keys are denomination values ("500","200",...), values are counts.
    denominationBreakdown: z.record(z.string(), z.number().int().min(0)).optional().nullable(),
    // Total cash claimed for this one invoice. Backend re-computes it from the
    // denomination breakdown and rejects mismatches.
    denominationTotal: z.number().int().min(0).optional().nullable(),
    // ── Cheque / Bank Transfer / Demand Draft extra fields ────────────────────
    chequeDate: z.string().optional().nullable(),   // instrument date (cheque / DD / transfer)
    branchName: z.string().max(100).optional().nullable(),
    bankName:   z.string().max(100).optional().nullable(),
    payerName:  z.string().max(200).optional().nullable(),
    // ── UPI / QR Payment extra fields ────────────────────────────────────────
    payerUpiId: z.string().max(100).optional().nullable(),  // payer's UPI ID / VPA
    // Structured accounting metadata. Common payment values remain on
    // payment_records; this object holds only method-specific additions.
    offlineDetails: z.object({
      transactionTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
      instrumentStatus: z.string().max(30).optional().nullable(),
      transferMode: z.string().max(40).optional().nullable(),
      transactionReference: z.string().max(100).optional().nullable(),
      receivingBank: z.string().max(100).optional().nullable(),
      receiverUpiId: z.string().max(100).optional().nullable(),
      payeeName: z.string().max(200).optional().nullable(),
      payableAt: z.string().max(120).optional().nullable(),
      collectionLocation: z.string().max(200).optional().nullable(),
      depositDate: z.string().optional().nullable(),
      depositBank: z.string().max(100).optional().nullable(),
      depositReference: z.string().max(100).optional().nullable(),
      returnDate: z.string().optional().nullable(),
      returnReason: z.string().max(500).optional().nullable(),
    }).strict().optional(),
  }).strict();

  const offlineDetailCorrectionSchema = z.object({
    reason: z.string().trim().min(3).max(500),
    referenceNumber: z.string().max(100).optional(),
    instrumentDate: z.string().refine(value => value === "" || isValidOfflineCorrectionDate(value), "Use a valid date in YYYY-MM-DD format.").transform(normalizeOptionalOfflineCorrectionDate).nullable().optional(),
    bankName: z.string().max(100).optional(),
    branchName: z.string().max(100).optional(),
    payerName: z.string().max(200).optional(),
    payerUpiId: z.string().max(100).optional(),
    transactionTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    instrumentStatus: z.string().max(30).optional(),
    transferMode: z.string().max(40).optional(),
    transactionReference: z.string().max(100).optional(),
    receivingBank: z.string().max(100).optional(),
    receiverUpiId: z.string().max(100).optional(),
    payeeName: z.string().max(200).optional(),
    payableAt: z.string().max(120).optional(),
    collectionLocation: z.string().max(200).optional(),
    depositDate: z.string().refine(value => value === "" || isValidOfflineCorrectionDate(value), "Use a valid date in YYYY-MM-DD format.").transform(normalizeOptionalOfflineCorrectionDate).nullable().optional(),
    depositBank: z.string().max(100).optional(),
    depositReference: z.string().max(100).optional(),
    returnDate: z.string().refine(value => value === "" || isValidOfflineCorrectionDate(value), "Use a valid date in YYYY-MM-DD format.").transform(normalizeOptionalOfflineCorrectionDate).nullable().optional(),
    returnReason: z.string().max(500).optional(),
  }).strict();

  // NOTE: GET /api/admin/fees/students/search is registered in routes.ts
  // (alongside the other /api/admin/fees routes) to ensure it is matched by
  // Express before Vite's dev-server middleware takes over. Do not re-add it here.

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
    const sessionFilter = await resolveFeeViewSession(req, res, schoolId);
    if (sessionFilter === undefined) return;
    if (sessionFilter === null) return res.json([]);

    const rows = await db.execute(sql`
      SELECT
        fr.id,
        fr.student_id       AS "studentId",
        fr.fee_type         AS "feeType",
        fr.fee_name         AS "feeName",
        fr.frequency        AS "frequency",
        fr.amount,
        fr.due_date         AS "dueDate",
        fr.status,
        fr.invoice_number   AS "invoiceNumber",
        fr.fee_period_start AS "feePeriodStart",
        fr.fee_period_end   AS "feePeriodEnd",
        fr.late_fee_amount  AS "lateFeeAmount",
        fr.late_fee_config  AS "lateFeeConfig",
        fr.academic_year    AS "academicYear"
      FROM fee_records fr
      WHERE fr.student_id = ${studentId}
        AND fr.school_id  = ${schoolId}
        AND fr.session_id = ${sessionFilter}
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
    const today = todayInIST();

    const invoices = (rows.rows as any[]).map(r => {
      const cfg     = r.lateFeeConfig ?? lateFeeMap.get((r.feeType ?? "").trim().toLowerCase());
      const accrued = cfg ? calculateLateFee(cfg, r.dueDate ?? "", r.status, new Date(today)) : 0;
      return { ...r, accruedLateFee: accrued, totalDue: Number(r.amount) + accrued };
    });

    res.json(invoices);
  });

  app.get("/api/admin/fees/payments", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const { studentId, feeRecordId } = req.query as { studentId?: string; feeRecordId?: string };
    const sessionFilter = await resolveFeeViewSession(req, res, schoolId);
    if (sessionFilter === undefined) return;
    if (sessionFilter === null) return res.json([]);
    const opts: { studentId?: number; feeRecordId?: number; sessionId?: number | null } = {};
    if (studentId) opts.studentId = parseInt(studentId);
    if (feeRecordId) {
      const parsedFeeId = parseInt(feeRecordId);
      if (isNaN(parsedFeeId)) return res.status(400).json({ message: "Invalid fee record ID" });
      const [fee] = await db.select({ id: feeRecords.id }).from(feeRecords).where(and(
        eq(feeRecords.id, parsedFeeId),
        eq(feeRecords.schoolId, schoolId),
        eq(feeRecords.sessionId, sessionFilter),
      ));
      if (!fee) return res.status(404).json({ message: "Fee record not found in the selected academic session." });
      opts.feeRecordId = parsedFeeId;
    }
    opts.sessionId = sessionFilter;
    const records = await storage.getPaymentRecordsBySchool(schoolId, opts);
    res.json(records);
  });

  app.post("/api/admin/fees/payments", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const multiInvoiceError = getMultiInvoiceOfflinePaymentError(req.body);
    if (multiInvoiceError) return res.status(400).json({ message: multiInvoiceError });
    const parsed = paymentBodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    const sessionFilter = await resolveFeeViewSession(req, res, schoolId);
    if (sessionFilter === undefined) return;
    if (sessionFilter === null) return res.status(409).json({ message: "No academic session selected or active." });

    const { idempotencyKey, ...paymentData } = parsed.data;
    const actor = await resolveFeeAuditActor(req, schoolId);

    // Tenant ownership: verify studentId belongs to this school
    const [studentCheck] = await db.select({ id: students.id, name: students.name })
      .from(students)
      .where(and(eq(students.id, paymentData.studentId), eq(students.schoolId, schoolId)));
    if (!studentCheck) return res.status(400).json({ message: "Student does not belong to this school" });

    // Tenant ownership: verify feeRecordId belongs to this school (and matches the student)
    if (paymentData.feeRecordId) {
      const [recCheck] = await db.select({
        id: feeRecords.id,
        studentId: feeRecords.studentId,
        sessionId: feeRecords.sessionId,
      })
        .from(feeRecords)
        .where(and(eq(feeRecords.id, paymentData.feeRecordId), eq(feeRecords.schoolId, schoolId)));
      if (!recCheck) return res.status(400).json({ message: "Fee record does not belong to this school" });
      if (recCheck.sessionId == null || Number(recCheck.sessionId) !== sessionFilter) {
        return res.status(403).json({ message: "Payments can only be recorded against invoices in the active selected academic session." });
      }
      if (recCheck.studentId !== paymentData.studentId) {
        return res.status(400).json({ message: "Fee record does not belong to the specified student" });
      }
      if (
        req.body?.sessionId != null
        && Number(req.body.sessionId) !== Number(recCheck.sessionId)
      ) {
        return res.status(400).json({ message: "Payment session must match the linked invoice session." });
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
          AND fr.session_id = ${sessionFilter}
          AND fr.status IN ('Due', 'Overdue')
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
      // Fully paid invoices are skipped because successful payments always set Paid.
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

          // Reject underpayments: every payment must settle its invoice in full.
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

          const newStatus = "Paid"; // one invoice is settled by one full payment
          await tx.execute(sql`
            UPDATE fee_records
            SET status       = ${newStatus},
                paid_date    = ${paymentData.receivedDate},
                receipt_number = ${opReceipt}
            WHERE id = ${step.invoiceId} AND school_id = ${schoolId}
          `);

          results.push({ feeRecordId: step.invoiceId, amount: safeAllocation, receiptNumber: opReceipt, newStatus });
        }
        if (results.length > 0) {
          const totalAllocated = results.reduce((sum, result) => sum + result.amount, 0);
          await appendFeeAudit({
            schoolId,
            actor,
            action: "fifo_payment",
            entityType: "payment_record",
            entityId: null,
            studentId: paymentData.studentId,
            studentName: studentCheck.name,
            sessionId: plan.every(step => step.sessionId === plan[0]?.sessionId)
              ? plan[0]?.sessionId ?? null
              : null,
            recordLabel: `${results.length} invoices`,
            amount: totalAllocated,
            description: `Recorded ₹${totalAllocated.toLocaleString("en-IN")} by ${paymentData.paymentMethod} for ${studentCheck.name} across ${results.length} invoices. Receipts: ${results.map(result => result.receiptNumber).join(", ")}.`,
            ipAddress: requestIpAddress(req),
          }, tx);
        }
      });

      const totalAllocated = results.reduce((s, r) => s + r.amount, 0);
      return res.status(201).json({ fifo: true, allocations: results, totalAllocated, unallocated: remaining });
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Invoice-first enforcement ─────────────────────────────────────────────
    // Offline payments must always be linked to an existing invoice (fee_record).
    // The standalone "create invoice + payment in one step" path has been removed.
    // Use "Add Invoice" to create a Due invoice first, then record payment here.
    if (!paymentData.feeRecordId) {
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

    // ── Cash denomination server-side recalculation ───────────────────────────
    // For Cash payments the frontend must supply the denomination breakdown.
    // The backend independently calculates the denomination total to prevent
    // frontend manipulation. It must match the one invoice amount supplied by
    // this request.
    if (paymentData.paymentMethod === "Cash") {
      const breakdown = paymentData.denominationBreakdown;
      if (!breakdown || typeof breakdown !== "object") {
        return res.status(400).json({ message: "Cash denomination breakdown is required for cash payments." });
      }
      const VALID_DENOMS = [500, 200, 100, 50, 20, 10, 5, 2, 1];
      let calculatedCash = 0;
      for (const dv of VALID_DENOMS) {
        const qty = Number(breakdown[String(dv)] ?? 0);
        if (!Number.isInteger(qty) || qty < 0) {
          return res.status(400).json({ message: `Invalid quantity for ₹${dv} denomination. Must be a non-negative integer.` });
        }
        calculatedCash += dv * qty;
      }
      const claimedTotal = paymentData.denominationTotal ?? paymentData.amount;
      if (calculatedCash !== claimedTotal) {
        return res.status(400).json({
          message: `Cash denomination total (₹${calculatedCash.toLocaleString("en-IN")}) does not match the declared cash total (₹${claimedTotal.toLocaleString("en-IN")}). Please recount.`,
        });
      }
      if (claimedTotal < paymentData.amount) {
        return res.status(400).json({
          message: `Cash counted (₹${claimedTotal.toLocaleString("en-IN")}) is less than this invoice's outstanding amount (₹${paymentData.amount.toLocaleString("en-IN")}).`,
        });
      }
    }

    // UPI / QR Payment: UTR and payment date are both required.
    if (paymentData.paymentMethod === "UpiQr") {
      if (!paymentData.referenceNumber?.trim()) {
        return res.status(400).json({ message: "UPI Transaction ID / UTR is required for UPI / QR payments." });
      }
      if (!paymentData.chequeDate?.trim()) {
        return res.status(400).json({ message: "Payment Date is required for UPI / QR payments." });
      }
    }

    // Generate a non-reusable offline receipt number BEFORE the transaction so
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
    // CONSEQUENCE — GAPS IN OFFLINE RECEIPT NUMBERS ARE EXPECTED:
    //   If the DB transaction below rolls back after this point (network
    //   drop, server restart, payment validation exit, etc.) the receipt number
    //   is permanently consumed but never stored anywhere.  The next
    //   successful payment will carry the following number.  These gaps do
    //   NOT represent missing or duplicate payments — they are a deliberate
    //   side-effect of the uniqueness guarantee. Accountants auditing the
    //   offline receipt sequence should treat non-consecutive numbers as normal.
    const opReceipt = await storage.nextReceiptNumber(schoolId, "OF");

    // Destructure out fee-record-only fields before passing to createPaymentRecord
    const { feeNotes: _fn, ...paymentOnly } = paymentData;

    // The validation and insert run inside one transaction with a SELECT … FOR
    // UPDATE row lock. Concurrent submissions for the same invoice serialize,
    // preserving the one-invoice, one-payment rule.
    let rec: any = null;
    let paymentBlock: {
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
          sql`SELECT status, amount, due_date, fee_type, late_fee_config FROM fee_records
              WHERE id = ${paymentOnly.feeRecordId} AND school_id = ${schoolId}
              FOR UPDATE`,
        );
        const lockedFee = lockResult.rows[0] as {
          status: string; amount: number; due_date: string; fee_type: string; late_fee_config: LateFeeConfig | null;
        } | undefined;

        if (lockedFee) {
          // ── One-invoice = one-payment rule (primary guards, run under lock) ──────

          // Guard 1: invoice already Paid — no second payment, ever.
          if (lockedFee.status === "Paid") {
            paymentBlock = {
              message: "This invoice has already been paid in full. No additional payments can be recorded against it.",
              invoiceAmount: Number(lockedFee.amount),
              totalAlreadyPaid: Number(lockedFee.amount),
              newAmount: paymentOnly.amount,
            };
            return;
          }

          // Compute the current late fee using the live moment — same function used by the
          // student portal and Razorpay order creation, so all three surfaces agree.
          const offlineLFConfig = lockedFee.late_fee_config ?? offlineLateFeeMap.get(
            (lockedFee.fee_type ?? "").trim().toLowerCase(),
          ) ?? DEFAULT_LATE_FEE_CONFIG;
          const offlineLateFee = calculateLateFee(
            offlineLFConfig, lockedFee.due_date ?? "", lockedFee.status,
          );
          const expectedTotal = Number(lockedFee.amount) + offlineLateFee;
          lateFeeForOfflineInsert = offlineLateFee; // capture for the INSERT below

          // Guard 2: payment must equal base + applicable late fee.
          if (paymentOnly.amount !== expectedTotal) {
            paymentBlock = {
              message: offlineLateFee > 0
                ? `Payment amount (₹${paymentOnly.amount.toLocaleString("en-IN")}) must equal the full invoice amount including late fee (₹${expectedTotal.toLocaleString("en-IN")} = ₹${Number(lockedFee.amount).toLocaleString("en-IN")} base + ₹${offlineLateFee.toLocaleString("en-IN")} late fee). Amounts below the full invoice total are not accepted.`
                : `Payment amount (₹${paymentOnly.amount.toLocaleString("en-IN")}) must equal the full invoice amount (₹${Number(lockedFee.amount).toLocaleString("en-IN")}). Amounts below the full invoice total are not accepted.`,
              invoiceAmount: expectedTotal,
              totalAlreadyPaid: 0,
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

      // Pre-serialise the JSONB denomination breakdown so node-postgres
      // treats it as a typed text parameter; PostgreSQL casts it via ::jsonb.
      const denomBreakdownJson = paymentOnly.denominationBreakdown
        ? JSON.stringify(paymentOnly.denominationBreakdown)
        : null;

      // Insert payment record inside the same transaction
      const insertResult = await tx.execute(
        sql`INSERT INTO payment_records
              (school_id, session_id, fee_record_id, student_id, payment_method,
               reference_number, received_date, amount, cashier_notes,
               idempotency_key, recorded_by, receipt_number, late_fee_paid,
               denomination_breakdown, cheque_date, branch_name, bank_name, payer_name, vpa)
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
              ${paymentOnly.feeRecordId != null ? lateFeeForOfflineInsert : (paymentData.lateFeePaid ?? 0)},
              ${denomBreakdownJson}::jsonb,
              ${paymentOnly.chequeDate ?? null},
              ${paymentOnly.branchName ?? null},
              ${paymentOnly.bankName ?? null},
              ${paymentOnly.payerName ?? null},
              ${paymentOnly.payerUpiId ?? null}
            )
            RETURNING *`,
      );
      rec = insertResult.rows[0];

      // Persist the additional accounting fields in the same transaction as the
      // canonical payment and payment-attempt records. The primary payment
      // fields above remain the source of truth for shared receipt data.
      const paymentRecordId = Number((rec as any)?.id);
      if (paymentRecordId) {
        const detail = paymentOnly.offlineDetails ?? {};
        await tx.execute(sql`
          INSERT INTO offline_payment_details (
            school_id, payment_record_id, transaction_time, instrument_status,
            transfer_mode, transaction_reference, receiving_bank, receiver_upi_id,
            payee_name, payable_at, collection_location, deposit_date, deposit_bank,
            deposit_reference, return_date, return_reason
          ) VALUES (
            ${schoolId}, ${paymentRecordId}, ${detail.transactionTime ?? null},
            ${detail.instrumentStatus ?? null}, ${detail.transferMode ?? null},
            ${detail.transactionReference ?? null}, ${detail.receivingBank ?? null},
            ${detail.receiverUpiId ?? null}, ${detail.payeeName ?? null},
            ${detail.payableAt ?? null}, ${detail.collectionLocation ?? null},
            ${detail.depositDate ?? null}, ${detail.depositBank ?? null},
            ${detail.depositReference ?? null}, ${detail.returnDate ?? null},
            ${detail.returnReason ?? null}
          )
        `);

        // Store the same selected offline method in the authoritative payment
        // attempt ledger at transaction time. external_id keeps this one-to-one
        // with the payment record and lets startup backfill safely skip it.
         await tx.execute(sql`
           INSERT INTO payment_attempts (
             school_id, student_id, fee_record_id, session_id, outcome,
             amount_paise, amount_captured_paise, currency, payment_method,
             bank_name, vpa, payer_name, receipt_number, external_id, source,
             created_at, updated_at
           ) VALUES (
             ${schoolId}, ${paymentOnly.studentId}, ${paymentOnly.feeRecordId},
             ${resolvedSessionId}, 'captured',
             ${paymentOnly.amount * 100}, ${paymentOnly.amount * 100}, 'INR',
             ${paymentOnly.paymentMethod},
             ${paymentOnly.bankName ?? null}, ${paymentOnly.payerUpiId ?? null},
             ${paymentOnly.payerName ?? null}, ${opReceipt}, ${`pr:${paymentRecordId}`},
             'admin', NOW(), NOW()
           )
           ON CONFLICT (school_id, external_id)
             WHERE external_id IS NOT NULL
           DO NOTHING
         `);
      }

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
          const newStatus = "Paid"; // one invoice is settled by one full payment
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
      if (rec) {
        const invoiceResult = await tx.execute(sql`
          SELECT invoice_number, fee_type, session_id
          FROM fee_records
          WHERE id = ${paymentOnly.feeRecordId} AND school_id = ${schoolId}
          LIMIT 1
        `);
        const invoice = invoiceResult.rows[0] as any;
        await appendFeeAudit({
          schoolId,
          actor,
          action: "payment",
          entityType: "payment_record",
          entityId: Number(rec.id),
          studentId: paymentOnly.studentId,
          studentName: studentCheck.name,
          sessionId: invoice?.session_id ?? null,
          recordLabel: opReceipt,
          amount: paymentOnly.amount,
          description: `Recorded ₹${Number(paymentOnly.amount).toLocaleString("en-IN")} by ${paymentOnly.paymentMethod} for ${studentCheck.name} against ${invoice?.invoice_number ?? invoice?.fee_type ?? "invoice"}. Receipt ${opReceipt}.`,
          ipAddress: requestIpAddress(req),
        }, tx);
      }
    });
    // ─────────────────────────────────────────────────────────────────────────

    // Resolve student name once for all payment audit entries below
    // TypeScript cannot track mutations to `let` variables that happen inside
    // async callbacks (the transaction lambda), so it infers `paymentBlock`
    // as the literal type `null` after the await, making the if-body unreachable.
    // Restore the declared union type with an explicit cast so the narrowing works.
    type PaymentBlock = { message: string; invoiceAmount: number; totalAlreadyPaid: number; newAmount: number };
    const paymentBlockSnap = paymentBlock as PaymentBlock | null;
    if (paymentBlockSnap) {
      await appendAudit(
        req, schoolId, "blocked_payment", "payment_record", paymentOnly.feeRecordId ?? null,
        `Blocked payment attempt of ₹${paymentBlockSnap.newAmount.toLocaleString("en-IN")} for ${studentCheck.name}. Invoice total ₹${paymentBlockSnap.invoiceAmount.toLocaleString("en-IN")}; already paid ₹${paymentBlockSnap.totalAlreadyPaid.toLocaleString("en-IN")}.`,
        paymentOnly.studentId,
      );
      return res.status(400).json({ ...paymentBlockSnap, paymentGuard: true });
    }
    res.status(201).json(rec);
  });

  // ── Offline payment-detail correction ─────────────────────────────────────
  // Amount, invoice, student, method, receipt, and recorded timestamps are
  // intentionally immutable. A correction may only amend accounting metadata,
  // and every change writes an immutable before/after revision first.
  app.patch("/api/admin/fees/payments/:id/offline-details", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const paymentRecordId = parseInt(req.params.id);
    if (isNaN(paymentRecordId)) return res.status(400).json({ message: "Invalid payment ID" });
    const parsed = offlineDetailCorrectionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues.map(issue => issue.message).join(", ") });
    }

    const patch = parsed.data;
    const actor = await resolveFeeAuditActor(req, schoolId);
    const [paymentContext] = await db.select({ sessionId: paymentRecords.sessionId })
      .from(paymentRecords)
      .where(and(eq(paymentRecords.id, paymentRecordId), eq(paymentRecords.schoolId, schoolId)));
    if (!paymentContext) return res.status(404).json({ message: "Payment record not found" });
    if (!await activeFinancialSessionGuard(res, schoolId, paymentContext.sessionId)) return;
    let response: any = null;
    let correctionError: string | null = null;
    await db.transaction(async (tx) => {
      const paymentResult = await tx.execute(sql`
        SELECT * FROM payment_records
        WHERE id = ${paymentRecordId} AND school_id = ${schoolId}
        FOR UPDATE
      `);
      const payment = paymentResult.rows[0] as any;
      if (!payment) return;
      if (isPortalPayment(payment.payment_method)) {
        correctionError = "Portal payments are managed by the gateway and cannot be edited here.";
        return;
      }

      const detailResult = await tx.execute(sql`
        SELECT * FROM offline_payment_details
        WHERE payment_record_id = ${paymentRecordId} AND school_id = ${schoolId}
        FOR UPDATE
      `);
      const detail = (detailResult.rows[0] ?? {}) as any;
      const next = {
        referenceNumber: patch.referenceNumber ?? payment.reference_number ?? null,
        instrumentDate: patch.instrumentDate !== undefined ? patch.instrumentDate : payment.cheque_date ?? null,
        bankName: patch.bankName ?? payment.bank_name ?? null,
        branchName: patch.branchName ?? payment.branch_name ?? null,
        payerName: patch.payerName ?? payment.payer_name ?? null,
        payerUpiId: patch.payerUpiId ?? payment.vpa ?? null,
        transactionTime: patch.transactionTime ?? detail.transaction_time ?? null,
        instrumentStatus: patch.instrumentStatus ?? detail.instrument_status ?? null,
        transferMode: patch.transferMode ?? detail.transfer_mode ?? null,
        transactionReference: patch.transactionReference ?? detail.transaction_reference ?? null,
        receivingBank: patch.receivingBank ?? detail.receiving_bank ?? null,
        receiverUpiId: patch.receiverUpiId ?? detail.receiver_upi_id ?? null,
        payeeName: patch.payeeName ?? detail.payee_name ?? null,
        payableAt: patch.payableAt ?? detail.payable_at ?? null,
        collectionLocation: patch.collectionLocation ?? detail.collection_location ?? null,
        depositDate: patch.depositDate !== undefined ? patch.depositDate : detail.deposit_date ?? null,
        depositBank: patch.depositBank ?? detail.deposit_bank ?? null,
        depositReference: patch.depositReference ?? detail.deposit_reference ?? null,
        returnDate: patch.returnDate !== undefined ? patch.returnDate : detail.return_date ?? null,
        returnReason: patch.returnReason ?? detail.return_reason ?? null,
      };
      const previous = {
        referenceNumber: payment.reference_number ?? null,
        instrumentDate: payment.cheque_date ?? null,
        bankName: payment.bank_name ?? null,
        branchName: payment.branch_name ?? null,
        payerName: payment.payer_name ?? null,
        payerUpiId: payment.vpa ?? null,
        transactionTime: detail.transaction_time ?? null,
        instrumentStatus: detail.instrument_status ?? null,
        transferMode: detail.transfer_mode ?? null,
        transactionReference: detail.transaction_reference ?? null,
        receivingBank: detail.receiving_bank ?? null,
        receiverUpiId: detail.receiver_upi_id ?? null,
        payeeName: detail.payee_name ?? null,
        payableAt: detail.payable_at ?? null,
        collectionLocation: detail.collection_location ?? null,
        depositDate: detail.deposit_date ?? null,
        depositBank: detail.deposit_bank ?? null,
        depositReference: detail.deposit_reference ?? null,
        returnDate: detail.return_date ?? null,
        returnReason: detail.return_reason ?? null,
      };

      await tx.execute(sql`
        UPDATE payment_records
        SET reference_number = ${next.referenceNumber}, cheque_date = ${next.instrumentDate},
            bank_name = ${next.bankName}, branch_name = ${next.branchName},
            payer_name = ${next.payerName}, vpa = ${next.payerUpiId}
        WHERE id = ${paymentRecordId} AND school_id = ${schoolId}
      `);
      await tx.execute(sql`
        INSERT INTO offline_payment_details (
          school_id, payment_record_id, transaction_time, instrument_status,
          transfer_mode, transaction_reference, receiving_bank, receiver_upi_id,
          payee_name, payable_at, collection_location, deposit_date, deposit_bank,
          deposit_reference, return_date, return_reason, updated_at
        ) VALUES (
          ${schoolId}, ${paymentRecordId}, ${next.transactionTime}, ${next.instrumentStatus},
          ${next.transferMode}, ${next.transactionReference}, ${next.receivingBank},
          ${next.receiverUpiId}, ${next.payeeName}, ${next.payableAt},
          ${next.collectionLocation}, ${next.depositDate}, ${next.depositBank},
          ${next.depositReference}, ${next.returnDate}, ${next.returnReason}, NOW()
        )
        ON CONFLICT (payment_record_id) DO UPDATE SET
          transaction_time = EXCLUDED.transaction_time, instrument_status = EXCLUDED.instrument_status,
          transfer_mode = EXCLUDED.transfer_mode, transaction_reference = EXCLUDED.transaction_reference,
          receiving_bank = EXCLUDED.receiving_bank, receiver_upi_id = EXCLUDED.receiver_upi_id,
          payee_name = EXCLUDED.payee_name, payable_at = EXCLUDED.payable_at,
          collection_location = EXCLUDED.collection_location, deposit_date = EXCLUDED.deposit_date,
          deposit_bank = EXCLUDED.deposit_bank, deposit_reference = EXCLUDED.deposit_reference,
          return_date = EXCLUDED.return_date, return_reason = EXCLUDED.return_reason, updated_at = NOW()
      `);
      await tx.execute(sql`
        INSERT INTO offline_payment_detail_revisions (
          school_id, payment_record_id, changed_by, reason, previous_values, new_values
        ) VALUES (
          ${schoolId}, ${paymentRecordId}, ${req.session.userId ?? null}, ${patch.reason},
          ${JSON.stringify(previous)}::jsonb, ${JSON.stringify(next)}::jsonb
        )
      `);
      const studentResult = await tx.execute(sql`
        SELECT name FROM students
        WHERE id = ${Number(payment.student_id)} AND school_id = ${schoolId}
        LIMIT 1
      `);
      await appendFeeAudit({
        schoolId,
        actor,
        action: "offline_payment_corrected",
        entityType: "payment_record",
        entityId: paymentRecordId,
        studentId: Number(payment.student_id),
        studentName: (studentResult.rows[0] as any)?.name ?? null,
        sessionId: payment.session_id ?? null,
        recordLabel: payment.receipt_number ?? `Payment ${paymentRecordId}`,
        amount: Number(payment.amount),
        description: `Corrected offline payment accounting details for receipt ${payment.receipt_number ?? paymentRecordId}. Reason: ${patch.reason}.`,
        ipAddress: requestIpAddress(req),
      }, tx);
      response = next;
    });
    if (correctionError) return res.status(400).json({ message: correctionError });
    if (!response) return res.status(404).json({ message: "Payment record not found" });
    res.json({ message: "Offline payment details corrected and revision recorded.", details: response });
  });

  // ── External Payment Settings ─────────────────────────────────────────────

  const externalSettingsSchema = z.object({
    isEnabled: z.boolean(),
    gatewayUrl: z.string().max(500).optional().nullable(),
    bannerMessage: z.string().max(500).optional().nullable(),
    razorpayEnabled: z.boolean().default(false),
    razorpayKeyId: z.string().max(200).optional().nullable(),
    // Secret is optional — null means "leave unchanged" when masked placeholder is sent
    razorpayKeySecret: z.string().max(500).optional().nullable(),
    razorpayWebhookSecret: z.string().max(500).optional().nullable(),
    // No prefix validation — both rzp_test_* and rzp_live_* keys are accepted.
  });

  const externalPortalVerifySchema = z.object({
    password: z.string().min(1).max(200),
  });

  app.post("/api/admin/fees/external-settings/verify-access", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const parsed = externalPortalVerifySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Current password is required." });
    }

    const userId = req.session.userId as number;
    const schoolId = req.session.schoolId as number;
    const admin = await storage.getUserById(userId);
    if (
      !admin ||
      !admin.isActive ||
      admin.role !== "admin" ||
      admin.schoolId !== schoolId
    ) {
      clearExternalPortalReauth(req);
      return res.status(403).json({ message: "Admin access required." });
    }

    const passwordMatches = await bcrypt.compare(parsed.data.password, admin.passwordHash);
    if (!passwordMatches) {
      clearExternalPortalReauth(req);
      return res.status(401).json({ message: "Incorrect password. Please try again." });
    }

    const verifiedAt = Date.now();
    (req.session as any).externalPortalReauth = {
      userId,
      schoolId,
      verifiedAt,
    };
    res.set("Cache-Control", "no-store");
    return res.json({
      ok: true,
      expiresAt: new Date(verifiedAt + EXTERNAL_PORTAL_REAUTH_TTL_MS).toISOString(),
    });
  });

  app.get("/api/admin/fees/external-settings", async (req, res) => {
    if (!await externalPortalGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    res.set("Cache-Control", "no-store");
    const settings = await storage.getExternalPaymentSettings(schoolId);

    // Resolve effective credentials (DB first, env-var fallback).
    // This makes the admin UI accurately reflect what the system will actually
    // use — including when only process.env.RAZORPAY_* vars are set (no DB save
    // needed on a local dev machine or fresh deployment).
    const creds = await resolveRazorpayCredentials(schoolId);

    const base = settings ?? {
      isEnabled: false, gatewayUrl: null, bannerMessage: null,
      razorpayEnabled: false,
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
    if (!await externalPortalGuard(req, res)) return;
    const parsed = externalSettingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    const schoolId = req.session.schoolId!;
    const previous = await storage.getExternalPaymentSettings(schoolId);

    const keyIdToSave = parsed.data.razorpayKeyId || null;

    // Don't overwrite secrets if the frontend sent the masked placeholder back
    const keySecret = parsed.data.razorpayKeySecret === "••••••••" ? undefined : (parsed.data.razorpayKeySecret || null);
    const webhookSecret = parsed.data.razorpayWebhookSecret === "••••••••" ? undefined : (parsed.data.razorpayWebhookSecret || null);

    const settingsPatch = {
      isEnabled: parsed.data.isEnabled,
      gatewayUrl: parsed.data.gatewayUrl || null,
      bannerMessage: parsed.data.bannerMessage || null,
      lastUpdatedBy: req.session.userId,
      razorpayEnabled: parsed.data.razorpayEnabled,
      razorpayKeyId: keyIdToSave,
      ...(keySecret !== undefined ? { razorpayKeySecret: keySecret } : {}),
      ...(webhookSecret !== undefined ? { razorpayWebhookSecret: webhookSecret } : {}),
      razorpayMode: "live",
    };

    const auditParts: string[] = [];
    auditParts.push(`External payment portal ${parsed.data.isEnabled ? "enabled" : "disabled"}`);
    if (parsed.data.razorpayEnabled !== (previous?.razorpayEnabled ?? false))
      auditParts.push(`Razorpay ${parsed.data.razorpayEnabled ? "enabled" : "disabled"}`);
    if (parsed.data.razorpayKeyId && parsed.data.razorpayKeyId !== previous?.razorpayKeyId)
      auditParts.push(`Razorpay Key ID updated`);
    if (keySecret !== undefined) auditParts.push("Razorpay Key Secret updated");
    if (webhookSecret !== undefined) auditParts.push("Razorpay Webhook Secret updated");
    const updated = await upsertExternalSettingsWithAudit(
      req, schoolId, settingsPatch, "external_settings", auditParts.join("; "),
    );
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
    if (!await externalPortalGuard(req, res)) return;
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

    const settingsPatch = {
      isEnabled:                previous?.isEnabled ?? false,
      gatewayUrl:               previous?.gatewayUrl ?? null,
      bannerMessage:            previous?.bannerMessage ?? null,
      lastUpdatedBy:            req.session.userId,
      razorpayEnabled: parsed.data.razorpayEnabled,
      razorpayKeyId:   keyIdToSave,
      ...(keySecret     !== undefined ? { razorpayKeySecret:     keySecret }     : {}),
      ...(webhookSecret !== undefined ? { razorpayWebhookSecret: webhookSecret } : {}),
      razorpayMode: "live",
    };

    const auditParts: string[] = [];
    if (parsed.data.razorpayEnabled !== (previous?.razorpayEnabled ?? false))
      auditParts.push(`Razorpay ${parsed.data.razorpayEnabled ? "enabled" : "disabled"}`);
    if (keyIdToSave && keyIdToSave !== previous?.razorpayKeyId)
      auditParts.push("Razorpay live Key ID updated");
    if (keySecret     !== undefined) auditParts.push("Razorpay Key Secret updated");
    if (webhookSecret !== undefined) auditParts.push("Razorpay Webhook Secret updated");

    const updated = await upsertExternalSettingsWithAudit(
      req, schoolId, settingsPatch, "razorpay_settings", auditParts.join("; "),
    );

    res.json({
      ...updated,
      razorpayMode: "live",
      razorpayKeySecret:     updated.razorpayKeySecret     ? "••••••••" : null,
      razorpayWebhookSecret: updated.razorpayWebhookSecret ? "••••••••" : null,
    });
  });

  // ── Wipe all Razorpay credentials (purge test/live keys completely) ──────────
  app.delete("/api/admin/fees/external-settings/razorpay/credentials", async (req, res) => {
    if (!await externalPortalGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const previous = await storage.getExternalPaymentSettings(schoolId);

    const settingsPatch = {
      isEnabled:                previous?.isEnabled ?? false,
      gatewayUrl:               previous?.gatewayUrl ?? null,
      bannerMessage:            previous?.bannerMessage ?? null,
      lastUpdatedBy:            req.session.userId,
      razorpayEnabled:  false,        // disable while wiping
      razorpayKeyId:    null,
      razorpayKeySecret: null,
      razorpayWebhookSecret: null,
      razorpayMode:     previous?.razorpayMode ?? "test",
    };
    await upsertExternalSettingsWithAudit(
      req,
      schoolId,
      settingsPatch,
      "razorpay_settings",
      "Removed Razorpay credentials and disabled online payments.",
    );

    res.json({ ok: true });
  });

  // ── Save external portal link settings only ───────────────────────────────
  const portalLinkSchema = z.object({
    isEnabled:                z.boolean(),
    gatewayUrl:               z.string().max(500).optional().nullable(),
    bannerMessage:            z.string().max(500).optional().nullable(),
  });

  app.put("/api/admin/fees/external-settings/portal", async (req, res) => {
    if (!await externalPortalGuard(req, res)) return;
    const parsed = portalLinkSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });
    const schoolId = req.session.schoolId!;
    const previous = await storage.getExternalPaymentSettings(schoolId);

    const settingsPatch = {
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
    };

    const auditParts: string[] = [];
    if (parsed.data.isEnabled !== (previous?.isEnabled ?? false))
      auditParts.push(`External portal ${parsed.data.isEnabled ? "enabled" : "disabled"}`);
    if (parsed.data.gatewayUrl !== (previous?.gatewayUrl ?? null))
      auditParts.push("Gateway URL updated");
    const updated = await upsertExternalSettingsWithAudit(
      req, schoolId, settingsPatch, "portal_settings", auditParts.join("; "),
    );

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
  const sigAuthMiddleware = async (req: any, res: any, next: any) => {
    if (!await externalPortalGuard(req, res)) return;
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
    if (!await externalPortalGuard(req, res)) return;
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
      if (studentId && !await requireStudentFeeSession(req, res, schoolId)) return;

      // Scope check: admin can only create orders for their own school's fees.
      // This prevents a rogue admin from binding their Razorpay credentials to
      // another tenant's fee record via the razorpay_order_id fallback.
      if (Number(fee.school_id) !== schoolId)
        return res.status(403).json({ message: "Access denied" });
      if (!await activeFinancialSessionGuard(res, schoolId, Number(fee.session_id))) return;
      const requestedSessionId = (req as any).viewSessionId as number | null | undefined;
      if (requestedSessionId != null && Number(fee.session_id) !== requestedSessionId) {
        return res.status(409).json({
          message: "The selected academic session does not match this invoice.",
          code: "INVOICE_SESSION_MISMATCH",
        });
      }

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
      const refundEntity = event?.payload?.refund?.entity ?? {};
      const disputeEntity = event?.payload?.dispute?.entity ?? {};
      const providerPaymentId = payment.id ?? refundEntity.payment_id ?? disputeEntity.payment_id ?? null;
      const providerOrderId = payment.order_id ?? refundEntity.order_id ?? disputeEntity.order_id ?? null;
      const notedSchoolId: number | null = notes.schoolId ? parseInt(notes.schoolId) : null;
      let schoolId: number | null = null;

      // Refund/dispute payloads often omit nested payment notes. Resolve only
      // when a stored provider identity maps unambiguously to one tenant; an
      // ambiguous identifier is deliberately not trusted to select a school.
      if (!schoolId && (providerPaymentId || providerOrderId)) {
        const candidates = (await db.execute(sql`
          SELECT school_id FROM payment_attempts
          WHERE (${providerPaymentId}::text IS NOT NULL AND razorpay_payment_id = ${providerPaymentId})
             OR (${providerOrderId}::text IS NOT NULL AND razorpay_order_id = ${providerOrderId})
          UNION
          SELECT school_id FROM fee_records
          WHERE ${providerOrderId}::text IS NOT NULL AND razorpay_order_id = ${providerOrderId}
          LIMIT 2
        `)).rows as any[];
        if (candidates.length === 1) schoolId = Number(candidates[0].school_id);
      }
      // Notes are only a fallback after stored provider identities have had a
      // chance to resolve the tenant. They can never override a known payment
      // or order relationship.
      if (!schoolId && notedSchoolId && !providerPaymentId && !providerOrderId) {
        schoolId = notedSchoolId;
      }

      if (!schoolId) {
        const unresolvedDeliveryId = await recordWebhookDelivery({
          schoolId: null, eventType: event.event ?? "unknown", rawBody: bodyStr, payload: event,
          razorpayPaymentId: providerPaymentId, razorpayOrderId: providerOrderId,
          providerOccurredAt: null, signatureVerified: false,
          verificationStatus: "unverifiable_unattributed",
        });
        await updateWebhookDelivery(unresolvedDeliveryId, {
          status: "failed",
          error: "Tenant secret unavailable; signature cannot be cryptographically verified",
          resolutionStatus: "unresolved",
        });
        return res.status(202).json({ ok: true, unresolved: true, deliveryId: unresolvedDeliveryId });
      }

      const creds = await resolveRazorpayCredentials(schoolId);
      if (!creds?.webhookSecret) {
        return res.status(400).json({ message: "Webhook secret not configured" });
      }

      // Verify HMAC
      const expected = crypto.createHmac("sha256", creds.webhookSecret).update(bodyStr).digest("hex");
      const sigBuf = Buffer.from(sig, "hex");
      const expBuf = Buffer.from(expected, "hex");
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        return res.status(400).json({ message: "Signature mismatch" });
      }
      // Do not persist or tenant-attribute a body until its signature has been
      // verified. Notes are attacker-controlled before this point.
      let webhookFeeRecordId = notes.feeRecordId ? parseInt(notes.feeRecordId) : null;
      let webhookResolutionSource: "notes" | "payment_id" | "order_id" | null =
        webhookFeeRecordId ? "notes" : null;
      let webhookResolutionReason: string | null = null;
      if (!webhookFeeRecordId && (refundEntity.id || disputeEntity.id || providerPaymentId || providerOrderId)) {
        const feeMatches = (await db.execute(sql`
          SELECT id FROM fee_records
          WHERE school_id = ${schoolId}
            AND (${providerOrderId}::text IS NOT NULL AND razorpay_order_id = ${providerOrderId})
          UNION
          SELECT fee_record_id AS id FROM payment_attempts
          WHERE school_id = ${schoolId}
            AND ${providerPaymentId}::text IS NOT NULL
            AND razorpay_payment_id = ${providerPaymentId}
        `)).rows as any[];
        if (feeMatches.length === 1) {
          webhookFeeRecordId = Number(feeMatches[0].id);
          webhookResolutionSource = providerPaymentId ? "payment_id" : "order_id";
        } else if (feeMatches.length > 1) {
          webhookResolutionReason = "ambiguous provider order identity";
        } else {
          webhookResolutionReason = "provider identity did not resolve an invoice";
        }
      }
      const webhookDeliveryId = await recordWebhookDelivery({
        schoolId,
        eventType: event.event ?? "unknown",
        rawBody: bodyStr,
        payload: event,
        razorpayPaymentId: payment.id ?? null,
        razorpayOrderId: payment.order_id ?? null,
        feeRecordId: webhookFeeRecordId,
        feeResolutionSource: webhookResolutionSource,
        resolutionReason: webhookResolutionReason,
        signatureVerified: true,
        razorpayRefundId: refundEntity.id ?? null,
        razorpayDisputeId: disputeEntity.id ?? null,
      });
      await updateWebhookDelivery(webhookDeliveryId, { verified: true });

      if (event.event === "payment.captured") {
        // `payment` is already declared in the outer scope above
        const feeRecordId = notes.feeRecordId ? parseInt(notes.feeRecordId) : null;
        if (!feeRecordId) return res.status(400).json({ message: "feeRecordId missing from notes" });
        const webhookReceivedAt = new Date();
        const providerCreatedAt = razorpayPaymentCreatedAt(payment);
        const providerCapturedAt = razorpayPaymentCapturedAt(payment, event);

        // The late fee snapshot embedded in the order notes at creation time — immutable.
        // This is the exact late fee the student was shown and Razorpay charged.
        const lateFeeFromNotes = Math.round(Number(notes.lateFeeAmount ?? 0)) || 0;

        // Load the fee record
        const feeRec = (await db.execute(sql`
          SELECT fr.*
          FROM fee_records fr
          JOIN academic_sessions acs
            ON acs.id = fr.session_id
           AND acs.school_id = fr.school_id
           AND acs.is_active = true
          WHERE fr.id = ${feeRecordId}
            AND fr.school_id = ${schoolId}
          LIMIT 1
        `)).rows[0] as any;
        if (!feeRec) {
          // A captured provider event can arrive after an admin archives the
          // session. Historical financial records are immutable: leave the
          // signed delivery recorded for reconciliation, but never create a
          // payment or alter an archived invoice.
          return res.status(409).json({ message: "Archived or unassigned academic-session invoices cannot be captured." });
        }

        // Already paid? idempotent — 200 OK. Clear a matching stale lock left
        // by an earlier delivery without touching an unrelated replacement order.
        if (feeRec.status === "Paid") {
          await db.transaction(async tx => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(${schoolId}, ${feeRecordId})`);
            await tx.execute(sql`
              UPDATE fee_records
              SET razorpay_order_id = NULL, razorpay_order_expires_at = NULL
              WHERE id = ${feeRecordId} AND school_id = ${schoolId}
                AND razorpay_order_id = ${payment.order_id ?? null}
            `);
            const auditExists = await tx.execute(sql`
              SELECT 1 FROM fee_audit_log
              WHERE school_id = ${schoolId}
                AND action = 'payment'
                AND entity_type = 'fee_record'
                AND entity_id = ${feeRecordId}
              LIMIT 1
            `);
            if (auditExists.rows.length === 0) {
              const studentResult = await tx.execute(sql`
                SELECT name FROM students
                WHERE id = ${Number(feeRec.student_id)} AND school_id = ${schoolId}
                LIMIT 1
              `);
              await appendFeeAudit({
                schoolId,
                actor: RAZORPAY_FEE_AUDIT_ACTOR,
                action: "payment",
                entityType: "fee_record",
                entityId: feeRecordId,
                studentId: Number(feeRec.student_id),
                studentName: (studentResult.rows[0] as any)?.name ?? null,
                sessionId: feeRec.session_id ?? null,
                recordLabel: feeRec.invoice_number ?? feeRec.receipt_number ?? `Invoice ${feeRecordId}`,
                eventKey: payment.id ? `payment-captured:${payment.id}` : null,
                amount: Number(feeRec.amount) + lateFeeFromNotes,
                description: `Online payment captured for ${feeRec.invoice_number ?? "invoice"}. Receipt ${feeRec.receipt_number ?? "recorded"}.`,
              }, tx);
            }
          });
          // A signed duplicate also repairs the payment-attempt projection. The
          // lifecycle idempotency key makes this safe for ordinary retries.
          const repairedAttemptId = await upsertPaymentAttempt({
            schoolId,
            studentId: Number(feeRec.student_id),
            feeRecordId,
            sessionId: feeRec.session_id ?? null,
            outcome: "captured",
            razorpayPaymentId: payment.id ?? null,
            razorpayOrderId: payment.order_id ?? null,
            amountPaise: payment.amount != null ? Number(payment.amount) : Number(feeRec.amount) * 100,
            currency: payment.currency ?? "INR",
            paymentMethod: payment.method ?? null,
            cardLast4: payment.card?.last4 ?? null,
            vpa: payment.vpa ?? null,
            payerEmail: payment.email ?? null,
            payerContact: payment.contact ?? null,
            rzpCreatedAt: providerCreatedAt,
            rzpCapturedAt: providerCapturedAt,
            webhookEvent: "payment.captured",
            webhookReceivedAt,
            webhookVerified: true,
            webhookPayload: payment,
            source: "webhook",
            receiptNumber: feeRec.receipt_number ?? null,
          });
          await appendPaymentAttemptEvent({
            schoolId, paymentAttemptId: repairedAttemptId, feeRecordId,
            studentId: Number(feeRec.student_id), sessionId: feeRec.session_id ?? null,
            eventType: "payment_captured", outcome: "captured", source: "webhook",
            webhookEventId: webhookDeliveryId, razorpayPaymentId: payment.id ?? null,
            razorpayOrderId: payment.order_id ?? null,
            amountPaise: payment.amount != null ? Number(payment.amount) : null,
            payload: event, providerOccurredAt: providerCapturedAt, occurredAt: webhookReceivedAt,
            idempotencyKey: `webhook:${webhookDeliveryId}:payment_captured`,
          });
          await updateWebhookDelivery(webhookDeliveryId, { status: "processed" });
          return res.json({ ok: true, idempotent: true });
        }

        // Atomically assign next ON receipt
        const receiptNumber = await storage.nextReceiptNumber(schoolId, "ON");

        // Update fee record to Paid + insert payment record — wrapped in a single
        // transaction so both succeed or fail together.  If the INSERT fails for
        // any reason (schema mismatch, constraint violation, transient error),
        // the UPDATE is rolled back automatically: fee_record stays Unpaid, the
        // webhook returns 500, and Razorpay retries until both operations commit.
        const now = webhookReceivedAt;
        const paidDateIST = razorpayPaymentBusinessDateIST(payment, event) ?? todayInIST(now);
        let idempotentDuplicate = false;
        try {
          await db.transaction(async (tx) => {
            await tx.execute(sql`
              UPDATE fee_records
              SET status = 'Paid',
                  paid_date = ${paidDateIST},
                  receipt_number = ${receiptNumber},
                  razorpay_order_id = NULL,
                  razorpay_order_expires_at = NULL
              WHERE id = ${feeRecordId} AND school_id = ${schoolId}
            `);

            // Insert payment record — guarded against duplicate delivery (23505).
            // Any error thrown here rolls back the UPDATE above automatically.
            try {
              await tx.insert(paymentRecords).values({
                schoolId,
                sessionId: feeRec.session_id ?? null,
                feeRecordId,
                studentId: Number(feeRec.student_id),
                paymentMethod: "Portal Payment",
                referenceNumber: payment.id,        // pay_XXXX
                receivedDate: paidDateIST,
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
            const studentResult = await tx.execute(sql`
              SELECT name FROM students
              WHERE id = ${Number(feeRec.student_id)} AND school_id = ${schoolId}
              LIMIT 1
            `);
            await appendFeeAudit({
              schoolId,
              actor: RAZORPAY_FEE_AUDIT_ACTOR,
              action: "payment",
              entityType: "fee_record",
              entityId: feeRecordId,
              studentId: Number(feeRec.student_id),
              studentName: (studentResult.rows[0] as any)?.name ?? null,
                sessionId: feeRec.session_id ?? null,
              recordLabel: feeRec.invoice_number ?? receiptNumber,
              eventKey: payment.id ? `payment-captured:${payment.id}` : null,
              amount: Number(feeRec.amount) + lateFeeFromNotes,
              description: `Online payment captured for ${feeRec.invoice_number ?? "invoice"}. Receipt ${receiptNumber}.`,
            }, tx);
          });
        } catch (txErr: any) {
          if (idempotentDuplicate) {
            return res.json({ ok: true, idempotent: true });
          }
          throw txErr; // non-idempotency error → outer catch → 500, Razorpay retries
        }
        // Broadcast real-time update → admin dashboard refreshes instantly
        broadcastPaymentUpdate(schoolId, { feeRecordId, receiptNumber });

        // Write to payment_attempts (non-blocking; existing payment_records write is the source of truth for receipts)
        const capturedAttemptId = await upsertPaymentAttempt({
          schoolId,
          studentId:         Number(feeRec.student_id),
          feeRecordId,
          sessionId:         feeRec.session_id ?? null,
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
          rzpCreatedAt:      providerCreatedAt,
          rzpCapturedAt:     providerCapturedAt,
          webhookEvent:      "payment.captured",
          webhookReceivedAt: now,
          webhookVerified:   true,
          webhookPayload:    payment,
          source:            "webhook",
          receiptNumber,
        });
        await appendPaymentAttemptEvent({
          schoolId, paymentAttemptId: capturedAttemptId, feeRecordId,
          studentId: Number(feeRec.student_id), sessionId: feeRec.session_id ?? null,
          eventType: "payment_captured", outcome: "captured", source: "webhook",
          webhookEventId: webhookDeliveryId, razorpayPaymentId: payment.id ?? null,
          razorpayOrderId: payment.order_id ?? null,
          amountPaise: payment.amount != null ? Number(payment.amount) : null,
          payload: event, providerOccurredAt: providerCapturedAt, occurredAt: now,
          idempotencyKey: `webhook:${webhookDeliveryId}:payment_captured`,
        });

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
                  sessionId:  feeRec.session_id ?? null,
                  outcome:    "captured",
                  source:     "webhook",
                  receiptNumber,
                  webhookEvent:    "payment.captured",
                  webhookVerified: true,
                  ...mapRazorpayPayment(paymentData),
                  razorpayOrderData: orderData,
                });
                await updateAttemptEnrichmentState({
                  schoolId, razorpayPaymentId: payment.id, razorpayOrderId: payment.order_id ?? null,
                  status: "completed",
                });
                await appendPaymentAttemptEvent({
                  schoolId, feeRecordId, studentId: Number(feeRec.student_id), sessionId: feeRec.session_id ?? null,
                  eventType: "api_enrichment_completed", source: "system",
                  razorpayPaymentId: payment.id, razorpayOrderId: payment.order_id ?? null,
                  payload: { entities: ["payment", "order"] }, occurredAt: new Date(),
                  idempotencyKey: `enrichment:completed:${payment.id}`,
                });
              }
            } catch (enrichErr) {
              console.warn("[webhook] captured enrichment failed:", enrichErr);
              await updateAttemptEnrichmentState({
                schoolId, razorpayPaymentId: payment.id ?? null, razorpayOrderId: payment.order_id ?? null,
                status: "failed", error: (enrichErr as any)?.message ?? String(enrichErr),
              });
              await appendPaymentAttemptEvent({
                schoolId, feeRecordId, studentId: Number(feeRec.student_id), sessionId: feeRec.session_id ?? null,
                eventType: "api_enrichment_failed", source: "system",
                razorpayPaymentId: payment.id ?? null, razorpayOrderId: payment.order_id ?? null,
                payload: { error: (enrichErr as any)?.message ?? String(enrichErr) }, occurredAt: new Date(),
                idempotencyKey: `enrichment:failed:${payment.id ?? payment.order_id}`,
              });
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

        const now = new Date();
        const providerCreatedAt = razorpayPaymentCreatedAt(payment);
        const providerFailedAt = razorpayEpochToDate(event.created_at) ?? providerCreatedAt;

        // Resolve the academic session for this fee record so the attempt is
        // correctly linked to the right session even when viewSessionId is not set.
        let webhookFeeSessionId: number | null = null;
        let webhookFeeIsActive = false;
        if (feeRecordId) {
          const sessionRow = (await db.execute(sql`
            SELECT fr.session_id,
              EXISTS (
                SELECT 1 FROM academic_sessions acs
                WHERE acs.id = fr.session_id
                  AND acs.school_id = fr.school_id
                  AND acs.is_active = true
              ) AS is_active_session
            FROM fee_records fr
            WHERE fr.id = ${feeRecordId}
              AND fr.school_id = ${schoolId}
            LIMIT 1
          `)).rows[0] as any;
          webhookFeeSessionId = sessionRow?.session_id ?? null;
          webhookFeeIsActive = Boolean(sessionRow?.is_active_session);
        }

        // Clearing the retry lock and recording the operational event are one
        // transaction. Payment-attempt details remain in their dedicated ledger.
        if (!feeRecordId || webhookFeeIsActive) await db.transaction(async tx => {
          let invoiceNumber: string | null = null;
          let studentName: string | null = null;
          if (feeRecordId) {
            const feeResult = await tx.execute(sql`
              UPDATE fee_records
              SET razorpay_order_id = NULL,
                  razorpay_order_expires_at = NULL
              WHERE id = ${feeRecordId} AND school_id = ${schoolId}
                AND razorpay_order_id = ${payment.order_id ?? null}
                AND EXISTS (
                  SELECT 1 FROM academic_sessions acs
                  WHERE acs.id = fee_records.session_id
                    AND acs.school_id = fee_records.school_id
                    AND acs.is_active = true
                )
              RETURNING invoice_number
            `);
            invoiceNumber = (feeResult.rows[0] as any)?.invoice_number ?? null;
          }
          if (studentIdResolved) {
            const studentResult = await tx.execute(sql`
              SELECT name FROM students
              WHERE id = ${studentIdResolved} AND school_id = ${schoolId}
              LIMIT 1
            `);
            studentName = (studentResult.rows[0] as any)?.name ?? null;
          }
          await appendFeeAudit({
            schoolId,
            actor: RAZORPAY_FEE_AUDIT_ACTOR,
            action: "payment_failed",
            entityType: "fee_record",
            entityId: feeRecordId,
            studentId: studentIdResolved,
            studentName,
            sessionId: webhookFeeSessionId,
            recordLabel: invoiceNumber,
            eventKey: payment.id || payment.order_id
              ? `payment-failed:${payment.id ?? payment.order_id}`
              : null,
            amount: payment.amount == null ? null : Math.round(Number(payment.amount) / 100),
            currency: payment.currency ?? "INR",
            description: feeRecordId
              ? `Online payment failed for ${invoiceNumber ?? "the selected invoice"}. No payment was recorded, and checkout was reopened for retry.`
              : "An online payment failed but could not be linked to a fee record. No payment was recorded.",
          }, tx);
        });
        if (feeRecordId) {
          console.log(`[razorpay webhook] Order lock cleared for fee #${feeRecordId} after payment failure`);
        }

        // Write to payment_attempts — webhook payload already has card + error details
        if (!feeRecordId || webhookFeeIsActive) {
        const failedAttemptId = await upsertPaymentAttempt({
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
          rzpCreatedAt:      providerCreatedAt,
          rzpFailedAt:       providerFailedAt,
          webhookEvent:      "payment.failed",
          webhookReceivedAt: now,
          webhookVerified:   true,
          webhookPayload:    payment,
          source:            "webhook",
        });
        await appendPaymentAttemptEvent({
          schoolId, paymentAttemptId: failedAttemptId, feeRecordId,
          studentId: studentIdResolved, sessionId: webhookFeeSessionId,
          eventType: "payment_failed", outcome: "failed", source: "webhook",
          webhookEventId: webhookDeliveryId, razorpayPaymentId: payment.id ?? null,
          razorpayOrderId: payment.order_id ?? null,
          amountPaise: payment.amount != null ? Number(payment.amount) : null,
          payload: event, providerOccurredAt: providerFailedAt, occurredAt: now,
          idempotencyKey: `webhook:${webhookDeliveryId}:payment_failed`,
        });
        } else {
          console.warn(`[razorpay webhook] payment.failed retained without financial projection for immutable fee #${feeRecordId}`);
        }

        console.log(`[razorpay webhook] Payment failed for fee #${feeRecordId}: ${errCode} — ${errDesc}`);

      // ── payment.authorized ───────────────────────────────────────────────────
      // Some UPI / netbanking flows send authorized → captured.
      // Do NOT mark fee as Paid here — wait for payment.captured.
      } else if (event.event === "payment.authorized") {
        const feeRecordId = notes.feeRecordId ? parseInt(notes.feeRecordId) : null;
        const studentIdAu = notes.studentId  ? parseInt(notes.studentId)  : null;
        const now = new Date();
        const providerCreatedAt = razorpayPaymentCreatedAt(payment);
        const providerAuthorizedAt = razorpayEpochToDate(event.created_at) ?? providerCreatedAt;
        const authorizedContext = (await db.execute(sql`
          SELECT fr.invoice_number, fr.session_id, s.name AS student_name,
            EXISTS (
              SELECT 1 FROM academic_sessions acs
              WHERE acs.id = fr.session_id
                AND acs.school_id = fr.school_id
                AND acs.is_active = true
            ) AS is_active_session
          FROM fee_records fr
          LEFT JOIN students s ON s.id = fr.student_id AND s.school_id = fr.school_id
          WHERE fr.id = ${feeRecordId} AND fr.school_id = ${schoolId}
          LIMIT 1
        `)).rows[0] as any;
        const authorizedFeeIsActive = !feeRecordId || Boolean(authorizedContext?.is_active_session);
        if (authorizedFeeIsActive) {
        await appendFeeAudit({
          schoolId,
          actor: RAZORPAY_FEE_AUDIT_ACTOR,
          action: "payment_authorized",
          entityType: "fee_record",
          entityId: feeRecordId,
          studentId: studentIdAu,
          studentName: authorizedContext?.student_name ?? null,
          sessionId: authorizedContext?.session_id ?? null,
          recordLabel: authorizedContext?.invoice_number ?? null,
          eventKey: payment.id ? `payment-authorized:${payment.id}` : null,
          amount: payment.amount == null ? null : Math.round(Number(payment.amount) / 100),
          currency: payment.currency ?? "INR",
          description: `Online payment authorized for ${authorizedContext?.invoice_number ?? "the selected invoice"} and awaiting capture.`,
        });
        // Write to payment_attempts
        const authorizedAttemptId = await upsertPaymentAttempt({
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
          rzpCreatedAt:      providerCreatedAt,
          rzpAuthorizedAt:   providerAuthorizedAt,
          webhookEvent:      "payment.authorized",
          webhookReceivedAt: now,
          webhookVerified:   true,
          webhookPayload:    payment,
          source:            "webhook",
        });
        await appendPaymentAttemptEvent({
          schoolId, paymentAttemptId: authorizedAttemptId, feeRecordId,
          studentId: studentIdAu, eventType: "payment_authorized", outcome: "authorized",
          source: "webhook", webhookEventId: webhookDeliveryId,
          razorpayPaymentId: payment.id ?? null, razorpayOrderId: payment.order_id ?? null,
          amountPaise: payment.amount != null ? Number(payment.amount) : null, payload: event,
          providerOccurredAt: providerAuthorizedAt,
          occurredAt: now,
          idempotencyKey: `webhook:${webhookDeliveryId}:payment_authorized`,
        });
        } else {
          console.warn(`[razorpay webhook] payment.authorized retained without financial projection for immutable fee #${feeRecordId}`);
        }

        console.log(`[razorpay webhook] payment.authorized fee #${feeRecordId} — ${payment.id ?? "?"}`);

      // ── refund.* ─────────────────────────────────────────────────────────────
      } else if (["refund.created", "refund.processed", "refund.failed", "refund.speed_changed"].includes(event.event)) {
        const refund        = event?.payload?.refund?.entity  ?? {};
        const refPmtEntity  = event?.payload?.payment?.entity ?? {};
        const refPmtId      = refund.payment_id ?? refPmtEntity.id ?? null;
        const refOrderId    = refund.order_id ?? refPmtEntity.order_id ?? null;
        let rfFeeRecordId: number | null = null;
        let rfStudentId:   number | null = null;
        let rfSessionId: number | null = null;
        let rfResolution: "notes" | "payment_id" | "order_id" | null = null;
        const linkedAttempt = (await db.execute(sql`
          SELECT fee_record_id, student_id, session_id
          FROM payment_attempts
          WHERE school_id = ${schoolId}
            AND ((${refPmtId}::text IS NOT NULL AND razorpay_payment_id = ${refPmtId})
              OR (${refOrderId}::text IS NOT NULL AND razorpay_order_id = ${refOrderId}))
          ORDER BY CASE WHEN razorpay_payment_id = ${refPmtId} THEN 0 ELSE 1 END, updated_at DESC, id DESC
          LIMIT 1
        `)).rows[0] as any;
        if (linkedAttempt?.fee_record_id != null) {
          rfFeeRecordId = Number(linkedAttempt.fee_record_id); rfStudentId = Number(linkedAttempt.student_id);
          rfSessionId = linkedAttempt.session_id == null ? null : Number(linkedAttempt.session_id);
          rfResolution = refPmtId && linkedAttempt ? "payment_id" : "order_id";
        } else if (refPmtId) {
          const pr = (await db.execute(sql`
            SELECT fee_record_id, student_id FROM payment_records
            WHERE school_id = ${schoolId} AND reference_number = ${refPmtId} LIMIT 1
          `)).rows[0] as any;
          if (pr) { rfFeeRecordId = Number(pr.fee_record_id); rfStudentId = Number(pr.student_id); rfResolution = "payment_id"; }
        }
        const now = new Date();
        const refundProviderAt = razorpayEpochToDate(refund.created_at);
        const refundEventAt = razorpayEpochToDate(event.created_at) ?? refundProviderAt;
        await updateWebhookDelivery(webhookDeliveryId, {
          feeRecordId: rfFeeRecordId, resolutionSource: rfResolution,
          resolutionStatus: rfFeeRecordId != null ? "resolved" : "unresolved",
        });
        const rfAction =
          event.event === "refund.created"   ? "refund_initiated" :
          event.event === "refund.processed" ? "refund_processed" :
          event.event === "refund.failed"    ? "refund_failed"    : "refund_updated";
        // The immutable refund ledger performs provider-ID-first reconciliation
        // and the net-paid invoice projection. payment_attempts remains a
        // compatibility projection/timeline and never becomes the refund
        // financial authority.
        const reconciledRefund = await reconcileRefundWebhook({
          schoolId,
          refund,
          eventType: event.event,
          webhookDeliveryId,
          providerOccurredAt: refundEventAt,
          fallbackFeeRecordId: rfFeeRecordId,
          fallbackStudentId: rfStudentId,
          fallbackSessionId: rfSessionId,
          afterReconcile: async (tx, context, state) => {
            const existingAudit = await tx.execute(sql`
              SELECT 1 FROM fee_audit_log
              WHERE school_id = ${schoolId}
                AND entity_type = 'refund'
                AND entity_id = ${state.refundId}
                AND action = ${state.action}
              LIMIT 1
            `);
            if (existingAudit.rows.length > 0) return;
            const amountRupees = Math.round(state.amountPaise / 100);
            const description =
              state.action === "refund_processed"
                ? `Refund of ₹${(state.amountPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })} completed for ${context.invoiceNumber ?? "the selected invoice"}.`
                : state.action === "refund_failed"
                  ? `Refund of ₹${(state.amountPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })} could not be completed and requires review.`
                  : state.action === "refund_speed_changed"
                    ? `Refund processing was updated for ${context.invoiceNumber ?? "the selected invoice"}.`
                    : `Refund of ₹${(state.amountPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })} was accepted for processing for ${context.invoiceNumber ?? "the selected invoice"}.`;
            await appendFeeAudit({
              schoolId,
              actor: RAZORPAY_FEE_AUDIT_ACTOR,
              action: state.action,
              entityType: "refund",
              entityId: state.refundId,
              studentId: context.studentId,
              studentName: context.studentName,
              sessionId: context.sessionId,
              recordLabel: context.invoiceNumber ?? `Payment ${context.paymentRecordId}`,
              eventKey: refund.id ? `refund:${refund.id}:${state.action}` : null,
              amount: amountRupees,
              description,
            }, tx);
          },
        });
        if (reconciledRefund.feeRecordId != null) {
          rfFeeRecordId = reconciledRefund.feeRecordId;
          rfResolution = "payment_id";
        }
        if (reconciledRefund.projectionApplied && (refPmtId || refOrderId) && refund.id) {
          const rfOutcome  = event.event === "refund.processed" ? "refunded" : "captured";
          await appendPaymentAttemptEvent({
            schoolId, feeRecordId: rfFeeRecordId, studentId: rfStudentId, sessionId: rfSessionId,
            eventType: rfAction, outcome: rfOutcome, source: "webhook",
            webhookEventId: webhookDeliveryId, razorpayPaymentId: refPmtId, razorpayOrderId: refOrderId,
            refundId: refund.id, amountPaise: refund.amount != null ? Number(refund.amount) : null,
            payload: { event, resolution: { source: rfResolution, status: rfFeeRecordId != null ? "resolved" : "unresolved" } },
            providerOccurredAt: refundEventAt, occurredAt: now,
            idempotencyKey: `webhook:${webhookDeliveryId}:${rfAction}`,
          });
        }

        console.log(`[razorpay webhook] ${event.event} fee #${rfFeeRecordId} refund ${refund.id ?? "?"}`);

      // ── payment.dispute.* ────────────────────────────────────────────────────
      } else if (event.event.startsWith("payment.dispute.")) {
        const dispute   = event?.payload?.dispute?.entity  ?? {};
        const disPmt    = event?.payload?.payment?.entity  ?? {};
        const disPmtId  = dispute.payment_id ?? disPmt.id ?? null;
        const disOrderId = dispute.order_id ?? disPmt.order_id ?? null;
        let disFeeId:  number | null = null;
        let disStudId: number | null = null;
        let disSessionId: number | null = null;
        let disResolution: "notes" | "payment_id" | "order_id" | null = null;
        const disAttempt = (await db.execute(sql`
          SELECT fee_record_id, student_id, session_id FROM payment_attempts
          WHERE school_id = ${schoolId}
            AND ((${disPmtId}::text IS NOT NULL AND razorpay_payment_id = ${disPmtId})
              OR (${disOrderId}::text IS NOT NULL AND razorpay_order_id = ${disOrderId}))
          ORDER BY CASE WHEN razorpay_payment_id = ${disPmtId} THEN 0 ELSE 1 END, updated_at DESC, id DESC LIMIT 1
        `)).rows[0] as any;
        if (disAttempt?.fee_record_id != null) {
          disFeeId = Number(disAttempt.fee_record_id); disStudId = Number(disAttempt.student_id);
          disSessionId = disAttempt.session_id == null ? null : Number(disAttempt.session_id);
          disResolution = disPmtId ? "payment_id" : "order_id";
        } else if (disPmtId) {
          const pr = (await db.execute(sql`
            SELECT fee_record_id, student_id FROM payment_records
            WHERE school_id = ${schoolId} AND reference_number = ${disPmtId}
            LIMIT 1
          `)).rows[0] as any;
          if (pr) { disFeeId = Number(pr.fee_record_id); disStudId = Number(pr.student_id); disResolution = "payment_id"; }
        }
        const now = new Date();
        const disputeProviderAt = razorpayEpochToDate(event.created_at)
          ?? razorpayEpochToDate(dispute.created_at);
        await updateWebhookDelivery(webhookDeliveryId, {
          feeRecordId: disFeeId, resolutionSource: disResolution,
          resolutionStatus: disFeeId != null ? "resolved" : "unresolved",
        });
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
        const disputeContext = (await db.execute(sql`
          SELECT fr.invoice_number, fr.session_id, s.name AS student_name
          FROM fee_records fr
          LEFT JOIN students s ON s.id = fr.student_id AND s.school_id = fr.school_id
          WHERE fr.id = ${disFeeId} AND fr.school_id = ${schoolId}
          LIMIT 1
        `)).rows[0] as any;
        await appendFeeAudit({
          schoolId,
          actor: RAZORPAY_FEE_AUDIT_ACTOR,
          action: disAction,
          entityType: "fee_record",
          entityId: disFeeId,
          studentId: disStudId,
          studentName: disputeContext?.student_name ?? null,
          sessionId: disputeContext?.session_id ?? disSessionId,
          recordLabel: disputeContext?.invoice_number ?? null,
          eventKey: dispute.id
            ? `dispute:${dispute.id}:${disAction}`
            : `razorpay-event:${webhookProviderEventId(bodyStr, event)}:${disAction}`,
          amount: dispute.amount == null ? null : Math.round(Number(dispute.amount) / 100),
          currency: dispute.currency ?? "INR",
          description: `${disLabel[event.event] ?? "Payment dispute updated"}${disputeContext?.invoice_number ? ` for ${disputeContext.invoice_number}` : ""}.`,
        });
        // Broadcast high-severity dispute events to admin dashboard
        if (event.event === "payment.dispute.created" || event.event === "payment.dispute.action_required" || event.event === "payment.dispute.lost") {
          // Notify admin dashboard — no receipt number for disputes, pass empty string
          broadcastPaymentUpdate(schoolId, { feeRecordId: disFeeId ?? 0, receiptNumber: "" });
        }
        if (disPmtId || disOrderId) {
          await appendPaymentAttemptEvent({
            schoolId, feeRecordId: disFeeId, studentId: disStudId, sessionId: disSessionId, eventType: disAction,
            source: "webhook", webhookEventId: webhookDeliveryId, razorpayPaymentId: disPmtId, razorpayOrderId: disOrderId,
            disputeId: dispute.id ?? null, amountPaise: dispute.amount != null ? Number(dispute.amount) : null,
            payload: { event, resolution: { source: disResolution, status: disFeeId != null ? "resolved" : "unresolved" } },
            providerOccurredAt: disputeProviderAt, occurredAt: now,
            idempotencyKey: `webhook:${webhookDeliveryId}:${disAction}`,
          });
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
        await updateWebhookDelivery(webhookDeliveryId, { status: "ignored" });
        return res.json({ ok: true, ignored: true });
      }

      await updateWebhookDelivery(webhookDeliveryId, { status: "processed" });
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
    const adminSchId = req.session?.userRole === "admin" ? req.session.schoolId : null;
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
    if (studentId && !await requireStudentFeeSession(req, res, schoolId)) return;
    const [targetFee] = await db.select({
      studentId: feeRecords.studentId,
      sessionId: feeRecords.sessionId,
    }).from(feeRecords).where(and(
      eq(feeRecords.id, feeRecordId),
      eq(feeRecords.schoolId, schoolId),
    ));
    if (!targetFee || (studentId && targetFee.studentId !== studentId)) {
      return res.status(404).json({ message: "Fee record not found" });
    }
    if (!await activeFinancialSessionGuard(res, schoolId, targetFee.sessionId)) return;
    const requestedSessionId = (req as any).viewSessionId as number | null | undefined;
    if (studentId && requestedSessionId != null) {
      const feeSession = await db.execute(sql`
        SELECT session_id
        FROM fee_records
        WHERE id = ${feeRecordId}
          AND school_id = ${schoolId}
          AND student_id = ${studentId}
        LIMIT 1
      `);
      const targetSessionId = (feeSession.rows[0] as any)?.session_id;
      if (targetSessionId != null && Number(targetSessionId) !== requestedSessionId) {
        return res.status(409).json({
          message: "The selected academic session does not match this invoice.",
          code: "INVOICE_SESSION_MISMATCH",
        });
      }
    }

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
    const selectedSessionCondition = requestedSessionId != null
      ? sql`AND session_id = ${requestedSessionId}`
      : sql``;

    // ── Clear order lock; only voluntary cancellation is an operational event ─
    // isCancelled=true means the student voluntarily closed the checkout modal
    // (no payment was attempted); isCancelled=false means Razorpay reported a
    // real payment failure (card declined, gateway error, etc.).
    const clientAction = isCancelled ? "payment_cancelled" : "payment_failed";

    // Resolve session_id and amount from the fee record for full audit trail
    let clientFeeSessionId: number | null = null;
    let clientFeeAmount: number | null = null;
    await db.transaction(async tx => {
      const updated = await tx.execute(sql`
        UPDATE fee_records
        SET razorpay_order_id = NULL,
            razorpay_order_expires_at = NULL
        WHERE ${condition}
          ${selectedSessionCondition}
          AND status IN ('Due', 'Overdue')
        RETURNING invoice_number, session_id, amount, student_id
      `);
      const fee = updated.rows[0] as any;
      clientFeeSessionId = fee?.session_id ?? null;
      clientFeeAmount = fee?.amount == null ? null : Number(fee.amount);
      if (!fee) return;
      const studentResult = await tx.execute(sql`
        SELECT name, digital_student_id FROM students
        WHERE id = ${Number(fee.student_id)} AND school_id = ${schoolId}
        LIMIT 1
      `);
      const studentSnapshot = studentResult.rows[0] as any;
      const clientActor = req.session?.userRole === "admin"
        ? await resolveFeeAuditActor(req, schoolId)
        : {
            actorId: null,
            actorTeacherId: null,
            actorStaffId: null,
            actorType: "student" as const,
            actorName: studentSnapshot?.name,
            actorRole: "Student",
            actorIdentifier: studentSnapshot?.digital_student_id,
          };
      await appendFeeAudit({
        schoolId,
        actor: clientActor,
        action: clientAction,
        entityType: "fee_record",
        entityId: feeRecordId,
        studentId: Number(fee.student_id),
        studentName: studentSnapshot?.name ?? null,
        studentIdentifier: studentSnapshot?.digital_student_id ?? null,
        sessionId: clientFeeSessionId,
        recordLabel: fee.invoice_number ?? null,
        eventKey: isCancelled
          ? (razorpayOrderId ? `checkout-cancelled:${razorpayOrderId}` : null)
          : (razorpayPaymentId || razorpayOrderId
              ? `payment-failed:${razorpayPaymentId ?? razorpayOrderId}`
              : null),
        amount: clientFeeAmount,
        description: isCancelled
          ? `Online checkout was cancelled for ${fee.invoice_number ?? "the selected invoice"}. No payment was recorded.`
          : `Online payment failed for ${fee.invoice_number ?? "the selected invoice"}. No payment was recorded, and checkout was reopened for retry.`,
        ipAddress: requestIpAddress(req),
      }, tx);
    });

    // Write to payment_attempts (non-fatal)
    const attemptOutcome = isCancelled ? "cancelled" : "failed";
    const now = new Date();
    try {
      const clientAttemptId = await upsertPaymentAttempt({
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
      });
      await appendPaymentAttemptEvent({
        schoolId, paymentAttemptId: clientAttemptId, feeRecordId, studentId: studentId ?? null,
        sessionId: clientFeeSessionId, eventType: isCancelled ? "checkout_cancelled" : "payment_failed",
        outcome: attemptOutcome, source: "client", razorpayPaymentId: razorpayPaymentId ?? null,
        razorpayOrderId: razorpayOrderId ?? null,
        amountPaise: clientFeeAmount != null ? Math.round(clientFeeAmount * 100) : null,
        payload: {
          errorCode: errorCode ?? null, errorDescription: errorDescription ?? null,
          errorSource: errorSource ?? null, errorStep: errorStep ?? null, errorReason: errorReason ?? null,
          response: sanitizePaymentPayload(
            typeof rawResponse === "object" && rawResponse
              ? { ...rawResponse, contact: undefined, email: undefined }
              : rawResponse,
          ),
        },
        occurredAt: now,
        // An order has at most one client close/failure classification. Webhook
        // failure remains a distinct provider event and is intentionally separate.
        idempotencyKey: `client:${isCancelled ? "cancel" : "failure"}:${razorpayOrderId ?? razorpayPaymentId ?? feeRecordId}`,
      });
    } catch (attemptErr) {
      console.warn("[clear-failed-order] payment attempt history write failed:", attemptErr);
    }

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
            await updateAttemptEnrichmentState({
              schoolId, razorpayPaymentId, razorpayOrderId: razorpayOrderId ?? null, status: "completed",
            });
            await appendPaymentAttemptEvent({
              schoolId, feeRecordId, studentId: studentId ?? null, sessionId: clientFeeSessionId,
              eventType: "api_enrichment_completed", source: "system",
              razorpayPaymentId, razorpayOrderId: razorpayOrderId ?? null,
              payload: {
                enrichmentType: ["Payment API", "Order API"],
                requestInitiatedAt: new Date().toISOString(), completionAt: new Date().toISOString(),
                status: "completed", snapshot: ["payment_attempts.razorpay_payment_data", "payment_attempts.razorpay_order_data"],
                normalizedFields: Object.keys(mapRazorpayPayment(paymentData)), apiSyncedAt: new Date().toISOString(),
              }, occurredAt: new Date(),
              idempotencyKey: `enrichment:completed:${razorpayPaymentId}`,
            });
          }
        } catch (enrichErr) {
          console.warn("[clear-failed-order] enrichment failed:", enrichErr);
          await updateAttemptEnrichmentState({
            schoolId, razorpayPaymentId, razorpayOrderId: razorpayOrderId ?? null,
            status: "failed", error: (enrichErr as any)?.message ?? String(enrichErr),
          });
          await appendPaymentAttemptEvent({
            schoolId, feeRecordId, studentId: studentId ?? null, sessionId: clientFeeSessionId,
            eventType: "api_enrichment_failed", source: "system",
            razorpayPaymentId, razorpayOrderId: razorpayOrderId ?? null,
            payload: { enrichmentType: ["Payment API", "Order API"], status: "failed", error: (enrichErr as any)?.message ?? String(enrichErr), completionAt: new Date().toISOString() }, occurredAt: new Date(),
            idempotencyKey: `enrichment:failed:${razorpayPaymentId}`,
          });
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
    const adminSchId  = req.session?.userRole === "admin" ? req.session.schoolId : null;
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
      if (studentId && !await requireStudentFeeSession(req, res, schoolId)) return;

      // Scope check. Administrators and students must both remain inside the
      // authenticated tenant before any Razorpay/API work is attempted.
      if (studentId && Number(feeRec.student_id) !== studentId)
        return res.status(403).json({ message: "Access denied" });

      const creds = await resolveRazorpayCredentials(schoolId);
      if (!creds?.keySecret) return res.status(400).json({ message: "Razorpay not configured" });
      if (Number(feeRec.school_id) !== schoolId)
        return res.status(403).json({ message: "Access denied" });
      if (!await activeFinancialSessionGuard(res, schoolId, Number(feeRec.session_id))) return;
      const requestedSessionId = (req as any).viewSessionId as number | null | undefined;
      if (requestedSessionId != null && Number(feeRec.session_id) !== requestedSessionId) {
        return res.status(409).json({
          message: "The selected academic session does not match this invoice.",
          code: "INVOICE_SESSION_MISMATCH",
        });
      }

      // Verify HMAC: SHA-256 of "order_id|payment_id"
      const body = `${razorpay_order_id}|${razorpay_payment_id}`;
      const expected = crypto.createHmac("sha256", creds.keySecret).update(body).digest("hex");
      if (expected !== razorpay_signature)
        return res.status(400).json({ message: "Signature verification failed" });

      // Already Paid? Idempotent — return success immediately, then try to fill in
      // payment_mode metadata in case the webhook INSERT missed it (e.g. older code path
      // or a rare webhook delivery gap).
      if (feeRec.status === "Paid") {
        // A client verify request can be retried after the financial write
        // committed but before attempt history was durable. Rebuild the same
        // idempotent projection/event here before reporting success.
        const repairedAttemptId = await upsertPaymentAttempt({
          schoolId,
          studentId: Number(feeRec.student_id),
          feeRecordId,
          sessionId: feeRec.session_id ?? null,
          outcome: "captured",
          razorpayPaymentId: razorpay_payment_id,
          razorpayOrderId: razorpay_order_id,
          amountPaise: Math.round(Number(feeRec.amount) * 100),
          currency: "INR",
          source: "client",
          receiptNumber: feeRec.receipt_number ?? null,
        });
        await appendPaymentAttemptEvent({
          schoolId, paymentAttemptId: repairedAttemptId, feeRecordId,
          studentId: Number(feeRec.student_id), sessionId: feeRec.session_id ?? null,
          eventType: "payment_captured", outcome: "captured", source: "client",
          razorpayPaymentId: razorpay_payment_id, razorpayOrderId: razorpay_order_id,
          amountPaise: Math.round(Number(feeRec.amount) * 100),
          payload: { verification: "client_retry_reconciliation" }, occurredAt: new Date(),
          idempotencyKey: `client-verify:${razorpay_payment_id}`,
        });
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

      // The browser callback is a convenience path, not the authority for a
      // captured payment. Fetch the payment and order from Razorpay and require
      // their captured/paid state, invoice notes, active order ID, and amount to
      // agree before recording a receipt.
      let verifiedPayment: any;
      let verifiedOrder: any;
      try {
        const rzpClient = new Razorpay({ key_id: creds.keyId, key_secret: creds.keySecret });
        [verifiedPayment, verifiedOrder] = await Promise.all([
          (rzpClient.payments as any).fetch(razorpay_payment_id),
          (rzpClient.orders as any).fetch(razorpay_order_id),
        ]);
      } catch (razorpayFetchErr: any) {
        console.warn(`[razorpay verify] authoritative payment lookup failed for ${razorpay_payment_id}:`, razorpayFetchErr?.message ?? razorpayFetchErr);
        return res.status(503).json({ message: "Unable to confirm the payment with Razorpay. Please try again in a moment." });
      }
      const verifiedCapture = validateCapturedRazorpayPayment({
        feeRecordId,
        schoolId,
        feeAmount: Number(feeRec.amount),
        expectedOrderId: feeRec.razorpay_order_id,
        payment: verifiedPayment,
        order: verifiedOrder,
      });
      if (!verifiedCapture.ok) return res.status(409).json({ message: verifiedCapture.message });
      const lateFeeFromOrder = verifiedCapture.lateFeeAmount;

      // Mark Paid — wrap UPDATE + INSERT in a single transaction so a crash or
      // INSERT failure (schema mismatch, constraint violation, transient DB error)
      // can never leave fee_records stamped Paid without a matching payment_records
      // row.  Matches the pattern used in the webhook handler.
      const receiptNumber = await storage.nextReceiptNumber(schoolId, "ON");
      const now = new Date();
      const providerCapturedAt = razorpayPaymentCapturedAt(verifiedPayment);
      const paidDateIST = razorpayPaymentBusinessDateIST(verifiedPayment) ?? todayInIST(now);
      let idempotentDuplicate = false;
      let canonicalReceipt: string | undefined;

      try {
        await db.transaction(async (tx) => {
          await tx.execute(sql`
            UPDATE fee_records
            SET status = 'Paid',
                paid_date = ${paidDateIST},
                receipt_number = ${receiptNumber},
                razorpay_order_id = NULL,
                razorpay_order_expires_at = NULL
            WHERE id = ${feeRecordId} AND school_id = ${schoolId}
          `);

          // Insert payment record inside the same transaction — any failure here
          // automatically rolls back the UPDATE above, so the fee stays Due and
          // the student can retry.
          try {
            await tx.insert(paymentRecords).values({
              schoolId,
              sessionId: feeRec.session_id ?? null,
              feeRecordId,
              studentId: Number(feeRec.student_id),
              paymentMethod: "Portal Payment",
              paymentMode: verifiedPayment.method ?? null,
              referenceNumber: razorpay_payment_id,
              receivedDate: paidDateIST,
              amount: verifiedCapture.amountPaise / 100,
              lateFeePaid: lateFeeFromOrder,
              cashierNotes: `Razorpay payment ID: ${razorpay_payment_id} (client-verified)`,
              recordedBy: null,
              receiptNumber,
              idempotencyKey: `rzp_${razorpay_payment_id}`,
              razorpayPaymentId: razorpay_payment_id ?? null,
              razorpayOrderId: razorpay_order_id ?? null,
              razorpaySignature: razorpay_signature ?? null,
              payerName: payer_name ?? null,
              payerEmail: verifiedPayment.email ?? payer_email ?? null,
              payerContact: verifiedPayment.contact ?? payer_contact ?? null,
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
          const studentResult = await tx.execute(sql`
            SELECT name FROM students
            WHERE id = ${Number(feeRec.student_id)} AND school_id = ${schoolId}
            LIMIT 1
          `);
          await appendFeeAudit({
            schoolId,
            actor: RAZORPAY_FEE_AUDIT_ACTOR,
            action: "payment",
            entityType: "fee_record",
            entityId: feeRecordId,
            studentId: Number(feeRec.student_id),
            studentName: (studentResult.rows[0] as any)?.name ?? null,
            sessionId: feeRec.session_id ?? null,
            recordLabel: feeRec.invoice_number ?? receiptNumber,
            eventKey: `payment-captured:${razorpay_payment_id}`,
            amount: verifiedCapture.amountPaise / 100,
            currency: verifiedPayment.currency ?? "INR",
            description: `Online payment captured for ${feeRec.invoice_number ?? "invoice"}. Receipt ${receiptNumber}.`,
          }, tx);
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
      // Record in payment_attempts — this is the primary write for the client-verify path.
      // The webhook (payment.captured) may arrive later and upsert the same row idempotently.
      const verifiedAttemptId = await upsertPaymentAttempt({
        schoolId,
        studentId:         Number(feeRec.student_id),
        feeRecordId,
        sessionId:         feeRec.session_id ?? null,
        outcome:           "captured",
        razorpayPaymentId: razorpay_payment_id,
        razorpayOrderId:   razorpay_order_id   ?? null,
        amountPaise:       verifiedCapture.amountPaise,
        amountCapturedPaise: verifiedCapture.amountPaise,
        currency:          verifiedPayment.currency ?? "INR",
        payerEmail:        verifiedPayment.email ?? payer_email ?? null,
        payerContact:      verifiedPayment.contact ?? payer_contact ?? null,
        payerName:         payer_name    ?? null,
        webhookEvent:      "verify",
        webhookReceivedAt: now,
        source:            "client",
        receiptNumber,
        ...mapRazorpayPayment(verifiedPayment),
      });
      await appendPaymentAttemptEvent({
        schoolId, paymentAttemptId: verifiedAttemptId, feeRecordId,
        studentId: Number(feeRec.student_id), sessionId: feeRec.session_id ?? null,
        eventType: "payment_captured", outcome: "captured", source: "client",
        razorpayPaymentId: razorpay_payment_id, razorpayOrderId: razorpay_order_id,
        amountPaise: verifiedCapture.amountPaise,
        payload: { verification: "authoritative_razorpay_api", payment: sanitizePaymentPayload(verifiedPayment) },
        providerOccurredAt: providerCapturedAt,
        occurredAt: now,
        idempotencyKey: `client-verify:${razorpay_payment_id}`,
      });

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
                sessionId:       feeRec.session_id ?? null,
                outcome:         "captured",
                source:          "client",
                receiptNumber,
                webhookEvent:    "verify",
                webhookVerified: true,
                ...mapRazorpayPayment(paymentData),
              });
              await updateAttemptEnrichmentState({
                schoolId, razorpayPaymentId: razorpay_payment_id, razorpayOrderId: razorpay_order_id ?? null,
                status: "completed",
              });
              await appendPaymentAttemptEvent({
                schoolId, feeRecordId, studentId: Number(feeRec.student_id), sessionId: feeRec.session_id ?? null,
                eventType: "api_enrichment_completed", source: "system",
                razorpayPaymentId: razorpay_payment_id, razorpayOrderId: razorpay_order_id ?? null,
                payload: { entities: ["payment", "order"] }, occurredAt: new Date(),
                idempotencyKey: `enrichment:completed:${razorpay_payment_id}`,
              });
            }
          } catch (enrichErr) {
            console.warn(`[razorpay verify] API enrichment failed for ${razorpay_payment_id}:`, enrichErr);
            await updateAttemptEnrichmentState({
              schoolId, razorpayPaymentId: razorpay_payment_id, razorpayOrderId: razorpay_order_id ?? null,
              status: "failed", error: (enrichErr as any)?.message ?? String(enrichErr),
            });
            await appendPaymentAttemptEvent({
                schoolId, feeRecordId, studentId: Number(feeRec.student_id), sessionId: feeRec.session_id ?? null,
              eventType: "api_enrichment_failed", source: "system",
              razorpayPaymentId: razorpay_payment_id, razorpayOrderId: razorpay_order_id ?? null,
              payload: { error: (enrichErr as any)?.message ?? String(enrichErr) }, occurredAt: new Date(),
              idempotencyKey: `enrichment:failed:${razorpay_payment_id}`,
            });
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
    const parsed = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).default(0),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      action: z.string().trim().min(1).max(50).regex(/^[A-Za-z0-9_-]+$/).optional(),
      search: z.string().trim().max(100).optional(),
      sessionId: z.coerce.number().int().positive().optional(),
    }).safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ message: "Invalid audit-log filters." });
    const { limit, offset, from, to, action, search, sessionId } = parsed.data;
    const dateRangeError = validateFeeAuditDateRange(from, to);
    if (dateRangeError) return res.status(400).json({ message: dateRangeError });
    if (action && !isCurrentFeeAuditAction(action)) {
      return res.status(400).json({ message: "The selected action is not available." });
    }
    const schoolId = req.session.schoolId!;
    const resolvedSessionId = await resolveFeeViewSession(req, res, schoolId);
    if (resolvedSessionId === undefined) return;
    if (resolvedSessionId === null) {
      return res.json({ entries: [], total: 0, actionOptions: [], limit, offset });
    }
    if (sessionId != null && sessionId !== resolvedSessionId) {
      return res.status(400).json({ message: "Audit-log session must match the selected academic session." });
    }
    const result = await storage.getFeeAuditLog(
      schoolId, limit, offset, from, to, action, search, resolvedSessionId,
    );
    res.json({ ...result, limit, offset });
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
    const actor = await resolveFeeAuditActor(req, schoolId);

    const parsed = z.object({
      // feePeriodStart/feePeriodEnd: required for monthly/quarterly fees (admin picks the month).
      // For annual/one-time the backend uses the active session dates automatically.
      feePeriodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
      feePeriodEnd:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(i => i.message).join(", ") });

    const { feePeriodStart: bodyPeriodStart, feePeriodEnd: bodyPeriodEnd } = parsed.data;
    let invoiceContext;
    try {
      invoiceContext = await prepareStructureInvoiceContext({
        schoolId,
        structureId,
        requestedPeriodStart: bodyPeriodStart,
        requestedPeriodEnd: bodyPeriodEnd,
      });
    } catch (error) {
      if (error instanceof InvoiceGenerationError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      throw error;
    }
    const { structure, session: invoiceSession, periodStart, periodEnd } = invoiceContext;
    const sessionId = invoiceSession.id;

    // The Student Registry is global and session-independent — a student's class/section
    // is always current in the registry regardless of how many sessions exist.
    // Invoice generation therefore reads directly from the registry (all active students)
    // rather than the session-enrollment table, ensuring no active student is ever skipped.
    const allActiveStudents = await storage.getStudentsBySchool(schoolId);
    const studentNameById = new Map(allActiveStudents.map(student => [student.id, student.name]));
    const effectiveRoster = allActiveStudents
      .filter(s => isStudentEligibleForStructure(structure, s))
      .map(s => ({ studentId: s.id, className: s.class!, sectionName: s.section! }));

    const applicableClasses: string[] = (structure as any).applicableClasses ?? [];
    const filtered = effectiveRoster;

    const existingRecords = await storage.getFeeRecordsBySchool(schoolId, { sessionId });
    const duplicateIndex = buildInvoiceDuplicateIndex(existingRecords);

    let created = 0, skipped = 0;
    for (const enrollment of filtered) {
      const result = await createStructureInvoice({
        context: invoiceContext,
        studentId: enrollment.studentId,
        duplicateIndex,
        createdBy: req.session.userId,
        afterCreate: async (tx, record) => {
          const studentName = studentNameById.get(enrollment.studentId) ?? null;
          await appendFeeAudit({
            schoolId,
            actor,
            action: "create",
            entityType: "fee_record",
            entityId: record.id,
            studentId: enrollment.studentId,
            studentName,
            sessionId: record.sessionId,
            recordLabel: record.invoiceNumber ?? `${record.feeType} invoice`,
            amount: record.amount,
            description: `Created ${record.invoiceNumber ?? "invoice"} for ${studentName ?? "Unknown student"} from fee structure "${structure.name}": ₹${Number(record.amount).toLocaleString("en-IN")}, due ${record.dueDate}.`,
            ipAddress: requestIpAddress(req),
          }, tx);
        },
      });
      if (!result.created) {
        skipped++;
        continue;
      }
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
        voided = await db.transaction(async tx => {
          const removed = await tx.delete(feeRecords)
            .where(and(
              eq(feeRecords.schoolId, schoolId),
              sql`id = ANY(${sql.raw(`ARRAY[${outIds.join(",")}]`)})`,
              or(eq(feeRecords.status, "Due"), eq(feeRecords.status, "Overdue")),
            ))
            .returning({ id: feeRecords.id });
          if (removed.length > 0) {
            const removedIds = new Set(removed.map(record => record.id));
            for (const record of outOfScopeRecs.filter(candidate => removedIds.has(candidate.id))) {
              const studentName = studentNameById.get(record.studentId) ?? null;
              await appendFeeAudit({
                schoolId,
                actor,
                action: "delete",
                entityType: "fee_record",
                entityId: record.id,
                studentId: record.studentId,
                studentName,
                sessionId: record.sessionId ?? sessionId,
                recordLabel: record.invoiceNumber ?? `${record.feeType} invoice`,
                amount: record.amount,
                description: `Deleted ${record.invoiceNumber ?? "invoice"} for ${studentName ?? "Unknown student"} because it no longer matched fee structure "${structure.name}".`,
                ipAddress: requestIpAddress(req),
              }, tx);
            }
          }
          return removed.length;
        });
      }
    }

    // Stamp last-generated timestamp on the structure
    await db.update(feeStructures)
      .set({ lastInvoicesGeneratedAt: new Date() })
      .where(eq(feeStructures.id, structureId));

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

    try {
      // ── Fetch payment record with all Razorpay / metadata columns ──────────
      const payRow = (await db.execute(sql`
        SELECT pr.*,
               COALESCE(t.full_name, nts.full_name) AS recorded_by_display_name,
               u.email AS recorded_by_email,
               u.role  AS recorded_by_role
        FROM payment_records pr
        LEFT JOIN users u ON u.id = pr.recorded_by
        LEFT JOIN teachers t ON t.user_id = u.id AND t.school_id = u.school_id
        LEFT JOIN non_teaching_staff nts ON nts.email = u.email AND nts.school_id = u.school_id
        WHERE pr.id = ${id} AND pr.school_id = ${schoolId}
        LIMIT 1
      `)).rows[0] as any;
      if (!payRow) return res.status(404).json({ message: "Payment record not found" });

      // ── Full school data ────────────────────────────────────────────────────
      const schoolRow = (await db.execute(sql`
        SELECT name, logo_url, address_line1, address_line2, city, state, pin_code,
               phone, email, affiliation_number, gstin
        FROM schools WHERE id = ${schoolId} LIMIT 1
      `)).rows[0] as any;

      // ── Student data ────────────────────────────────────────────────────────
      const studentRow = (await db.execute(sql`
        SELECT name, digital_student_id, class, section, roll_number,
               guardian_name, phone, email
        FROM students WHERE id = ${payRow.student_id} AND school_id = ${schoolId}
        LIMIT 1
      `)).rows[0] as any;
      if (!studentRow) return res.status(404).json({ message: "Student not found" });

      // ── Fee record (linked) ─────────────────────────────────────────────────
      let feeRow: any = null;
      if (payRow.fee_record_id) {
        feeRow = (await db.execute(sql`
          SELECT fee_type, fee_name, invoice_number, academic_year, fee_period_start,
                 fee_period_end, due_date, amount, late_fee_amount, breakdown_snapshot,
                 notes, session_id
          FROM fee_records
          WHERE id = ${payRow.fee_record_id} AND school_id = ${schoolId}
          LIMIT 1
        `)).rows[0] as any;
      }

      // ── Offline payment details sidecar ────────────────────────────────────
      const odRow = (await db.execute(sql`
        SELECT transaction_time, instrument_status, transfer_mode, transaction_reference,
               receiving_bank, receiver_upi_id, payee_name, payable_at, collection_location,
               deposit_date, deposit_bank, deposit_reference, return_date, return_reason
        FROM offline_payment_details
        WHERE school_id = ${schoolId} AND payment_record_id = ${id}
        LIMIT 1
      `)).rows[0] as any;

      // ── Provider timestamps from payment_attempts ───────────────────────────
      const attemptRow = (await db.execute(sql`
        SELECT rzp_created_at, rzp_captured_at, payment_method AS rzp_method,
               card_network
        FROM payment_attempts
        WHERE school_id = ${schoolId}
          AND razorpay_payment_id = ${payRow.razorpay_payment_id ?? ""}
        ORDER BY created_at DESC LIMIT 1
      `)).rows[0] as any;

      // ── Academic session label ─────────────────────────────────────────────
      let sessionLabel: string | null = null;
      const sessionId = feeRow?.session_id ?? payRow.session_id ?? null;
      if (sessionId) {
        const sess = (await db.execute(sql`
          SELECT session_name FROM academic_sessions WHERE id = ${sessionId} LIMIT 1
        `)).rows[0] as any;
        sessionLabel = sess?.session_name ?? null;
      }

      // ── Signature ──────────────────────────────────────────────────────────
      const sigMeta = await storage.getSchoolMetadataRaw(schoolId, "fee_receipt_signature") as any;
      const sigRelUrl = sigMeta?.processedSignatureUrl ?? sigMeta?.originalSignatureUrl ?? sigMeta?.fileUrl ?? null;
      const sigUrl = sigRelUrl
        ? (/^https?:\/\//i.test(sigRelUrl) ? sigRelUrl : `${req.protocol}://${req.get("host")}${sigRelUrl}`)
        : null;
      const signatoryMeta = await storage.getSchoolMetadataRaw(schoolId, "fee_signatory_name") as any;
      const signatoryName: string | null =
        (typeof signatoryMeta === "string" && signatoryMeta.trim()) ? signatoryMeta.trim()
        : (typeof signatoryMeta?.name === "string" && signatoryMeta.name.trim()) ? signatoryMeta.name.trim()
        : null;

      // ── Resolve school logo absolute URL ───────────────────────────────────
      const logoRelUrl = schoolRow?.logo_url ?? null;
      const logoUrl = logoRelUrl
        ? (/^https?:\/\//i.test(logoRelUrl) ? logoRelUrl : `${req.protocol}://${req.get("host")}${logoRelUrl}`)
        : null;

      // ── Build ReceiptData ──────────────────────────────────────────────────
      const receiptData: ReceiptData = {
        school: {
          name: schoolRow?.name ?? "School",
          logoUrl,
          addressLine1: schoolRow?.address_line1 ?? null,
          addressLine2: schoolRow?.address_line2 ?? null,
          city: schoolRow?.city ?? null,
          state: schoolRow?.state ?? null,
          pinCode: schoolRow?.pin_code ?? null,
          phone: schoolRow?.phone ?? null,
          email: schoolRow?.email ?? null,
          affiliationNumber: schoolRow?.affiliation_number ?? null,
          gstin: schoolRow?.gstin ?? null,
        },
        student: {
          name: studentRow.name,
          digitalStudentId: studentRow.digital_student_id,
          rollNumber: studentRow.roll_number ?? null,
          class: studentRow.class,
          section: studentRow.section,
          guardianName: studentRow.guardian_name ?? null,
          phone: studentRow.phone ?? null,
          email: studentRow.email ?? null,
        },
        fee: {
          feeType: feeRow?.fee_type ?? payRow.payment_method,
          feeName: feeRow?.fee_name ?? feeRow?.fee_type ?? null,
          invoiceNumber: feeRow?.invoice_number ?? null,
          academicYear: feeRow?.academic_year ?? null,
          feePeriodStart: feeRow?.fee_period_start
            ? formatDateOnly(feeRow.fee_period_start) : null,
          feePeriodEnd: feeRow?.fee_period_end
            ? formatDateOnly(feeRow.fee_period_end) : null,
          dueDate: feeRow?.due_date ? formatDateOnly(String(feeRow.due_date).slice(0, 10)) : null,
          amount: feeRow ? Number(feeRow.amount ?? 0) : Number(payRow.amount ?? 0),
          lateFeeAmount: feeRow ? Number(feeRow.late_fee_amount ?? 0) : Number(payRow.late_fee_paid ?? 0),
          breakdown: Array.isArray(feeRow?.breakdown_snapshot) ? feeRow.breakdown_snapshot : [],
          notes: feeRow?.notes ?? null,
        },
        payment: {
          receiptNumber: payRow.receipt_number ?? null,
          amount: Number(payRow.amount ?? 0),
          lateFeePaid: Number(payRow.late_fee_paid ?? 0),
          paymentMethod: payRow.payment_method ?? "Cash",
          receivedDate: payRow.received_date ? String(payRow.received_date).slice(0, 10) : "—",
          paymentDateTimeIST: formatInstantIST(payRow.created_at),
          cashierNotes: payRow.cashier_notes ?? null,
          // Online
          razorpayPaymentId: payRow.razorpay_payment_id ?? null,
          razorpayOrderId: payRow.razorpay_order_id ?? null,
          paymentMode: payRow.payment_mode ?? null,
          bankName: payRow.bank_name ?? null,
          cardLast4: payRow.card_last4 ?? null,
          cardNetwork: attemptRow?.rzp_method === "card" ? (attemptRow?.card_network ?? null) : null,
          vpa: payRow.vpa ?? null,
          payerName: payRow.payer_name ?? null,
          payerEmail: payRow.payer_email ?? null,
          payerContact: payRow.payer_contact ?? null,
          gatewayStatus: payRow.gateway_status ?? null,
          providerCreatedIST: attemptRow?.rzp_created_at ? formatInstantIST(attemptRow.rzp_created_at) : null,
          providerCapturedIST: attemptRow?.rzp_captured_at ? formatInstantIST(attemptRow.rzp_captured_at) : null,
          // Offline
          denominationBreakdown: payRow.denomination_breakdown ?? null,
          referenceNumber: payRow.reference_number ?? null,
          instrumentDate: payRow.cheque_date ? formatDateOnly(String(payRow.cheque_date).slice(0, 10)) : null,
          branchName: payRow.branch_name ?? null,
          offlineDetail: odRow ? {
            transactionTime: odRow.transaction_time ?? null,
            instrumentStatus: odRow.instrument_status ?? null,
            transferMode: odRow.transfer_mode ?? null,
            transactionReference: odRow.transaction_reference ?? null,
            receivingBank: odRow.receiving_bank ?? null,
            receiverUpiId: odRow.receiver_upi_id ?? null,
            payeeName: odRow.payee_name ?? null,
            payableAt: odRow.payable_at ?? null,
            collectionLocation: odRow.collection_location ?? null,
            depositDate: odRow.deposit_date ?? null,
            depositBank: odRow.deposit_bank ?? null,
            depositReference: odRow.deposit_reference ?? null,
            returnDate: odRow.return_date ?? null,
            returnReason: odRow.return_reason ?? null,
          } : null,
          // Never fall back to email — "School Finance Office" is the renderer's fallback
          recordedByName: payRow.recorded_by_display_name ?? null,
          recordedByRole: payRow.recorded_by_role ?? null,
        },
        signature: { imageUrl: sigUrl, signatoryName },
        academicSessionLabel: sessionLabel,
        generatedAtIST: formatInstantIST(new Date()),
      };

      // ── Cash denomination integrity check ──────────────────────────────────
      if (payRow.payment_method === "Cash" && payRow.denomination_breakdown) {
        const breakdown = payRow.denomination_breakdown as Record<string, number>;
        const denomTotal = Object.entries(breakdown)
          .filter(([, qty]) => Number(qty) > 0)
          .reduce((sum, [denom, qty]) => sum + Number(denom) * Number(qty), 0);
        const paidAmount = Number(payRow.amount ?? 0);
        if (Math.abs(denomTotal - paidAmount) > 0.01) {
          return res.status(400).json({
            message: `Cash denomination total (₹${denomTotal.toLocaleString("en-IN")}) does not match the recorded payment amount (₹${paidAmount.toLocaleString("en-IN")}). Receipt cannot be generated until the denomination record is corrected.`,
          });
        }
      }

      const html = renderReceiptHtml(receiptData);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Disposition", `inline; filename="payment-receipt-${id}.html"`);
      res.send(html);
    } catch (err) {
      console.error("[payment receipt]", err);
      res.status(500).json({ message: String(err) });
    }
  });

  // ── Transaction Detail — JSON (for accordion in Ledger) ─────────────────
  app.get("/api/admin/fees/payments/:paymentId/refund-eligibility", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const paymentRecordId = Number(req.params.paymentId);
    if (!Number.isInteger(paymentRecordId)) return res.status(400).json({ message: "Invalid payment ID." });
    try {
      const eligibility = await getRefundEligibility(req.session.schoolId!, paymentRecordId);
      if (!eligibility) return res.status(404).json({ message: "Payment record not found." });
      const [user] = await db.select({ canRefund: users.canRefund }).from(users)
        .where(and(eq(users.id, req.session.userId!), eq(users.schoolId, req.session.schoolId!)));
      res.json({ ...eligibility, canInitiateRefund: Boolean(user?.canRefund), reasonCodes: REFUND_REASON_CODES });
    } catch (err) {
      console.error("[refund eligibility]", err);
      res.status(500).json({ message: "Unable to calculate refund eligibility." });
    }
  });

  app.post("/api/admin/fees/payments/:paymentId/refunds", async (req, res) => {
    if (!await refundGuard(req, res)) return;
    const paymentRecordId = Number(req.params.paymentId);
    const amountPaise = Number(req.body?.amountPaise);
    const reasonCode = req.body?.reasonCode as RefundReasonCode;
    const reasonText = typeof req.body?.reasonText === "string" ? req.body.reasonText.trim().slice(0, 500) : null;
    const internalNote = typeof req.body?.internalNote === "string" ? req.body.internalNote.trim().slice(0, 2000) : null;
    const idempotencyKey = String(req.headers["x-idempotency-key"] ?? req.body?.idempotencyKey ?? "");
    if (!Number.isInteger(paymentRecordId) || !Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
      return res.status(400).json({ message: "A valid payment and whole-paise refund amount are required." });
    }
    if (!/^[A-Za-z0-9:_-]{16,120}$/.test(idempotencyKey)) {
      return res.status(400).json({ message: "A valid idempotency key is required." });
    }
    try {
      if (!await activePaymentRecordGuard(res, req.session.schoolId!, paymentRecordId)) return;
      const actor = await resolveFeeAuditActor(req, req.session.schoolId!);
      const forwarded = req.headers["x-forwarded-for"] as string | undefined;
      const reservation = await reserveRefundRequest({
        schoolId: req.session.schoolId!, paymentRecordId, amountPaise, reasonCode, reasonText, internalNote,
        idempotencyKey, requestedBy: req.session.userId!,
        requesterIp: forwarded?.split(",")[0]?.trim() ?? req.socket?.remoteAddress ?? null,
        afterReserve: async (tx, context) => {
          await appendFeeAudit({
            schoolId: req.session.schoolId!,
            actor,
            action: "refund_requested",
            entityType: "payment_record",
            entityId: paymentRecordId,
            studentId: context.studentId,
            studentName: context.studentName,
            sessionId: context.sessionId,
            recordLabel: context.invoiceNumber ?? `Payment ${paymentRecordId}`,
            amount: Math.round(amountPaise / 100),
            description: `Requested a refund of ₹${(amountPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })} for ${context.studentName} against ${context.invoiceNumber ?? "the selected payment"}. Reason: ${reasonCode.replaceAll("_", " ")}.`,
            ipAddress: requestIpAddress(req),
          }, tx);
        },
      });
      if (reservation.idempotent) return res.json({ refund: reservation.refund, summary: reservation.summary, idempotent: true });

      const creds = await resolveRazorpayCredentials(req.session.schoolId!);
      if (!creds?.keySecret || !creds.enabled) {
        await markRefundReconciliationRequired(
          req.session.schoolId!,
          Number(reservation.refund.id),
          new Error("Razorpay is not configured for this school."),
          {
            afterUpdate: async (tx, context, state) => {
              await appendFeeAudit({
                schoolId: req.session.schoolId!,
                actor: SYSTEM_FEE_AUDIT_ACTOR,
                action: state.action,
                entityType: "refund",
                entityId: state.refundId,
                studentId: context.studentId,
                studentName: context.studentName,
                sessionId: context.sessionId,
                recordLabel: context.invoiceNumber ?? `Payment ${context.paymentRecordId}`,
                eventKey: `refund:${state.refundId}:${state.action}`,
                amount: Math.round(state.amountPaise / 100),
                description: `Refund outcome for ${context.invoiceNumber ?? "the selected invoice"} could not be confirmed and requires reconciliation.`,
              }, tx);
            },
          },
        );
        return res.status(503).json({ message: "Refund is reserved but requires reconciliation because Razorpay is not configured.", refundId: reservation.refund.id });
      }
      try {
        const razorpay = new Razorpay({ key_id: creds.keyId, key_secret: creds.keySecret });
        // No student, invoice, or other correlation values are sent in provider
        // notes. The Razorpay payment ID and local immutable event trail are the
        // correlation authority.
        const providerRefund = await (razorpay.payments as any).refund(reservation.context.razorpayPaymentId, {
          amount: amountPaise,
          speed: "normal",
        });
        const refund = await recordRefundApiSubmission(
          req.session.schoolId!,
          Number(reservation.refund.id),
          providerRefund,
          {
            afterSubmission: async (tx, context, state) => {
              await appendFeeAudit({
                schoolId: req.session.schoolId!,
                actor: RAZORPAY_FEE_AUDIT_ACTOR,
                action: state.action,
                entityType: "refund",
                entityId: state.refundId,
                studentId: context.studentId,
                studentName: context.studentName,
                sessionId: context.sessionId,
                recordLabel: context.invoiceNumber ?? `Payment ${context.paymentRecordId}`,
                eventKey: `refund:${state.refundId}:${state.action}`,
                amount: Math.round(state.amountPaise / 100),
                description: `Refund of ₹${(state.amountPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })} was accepted for processing for ${context.invoiceNumber ?? "the selected invoice"}.`,
              }, tx);
            },
            afterSuperseded: async (tx, context, state) => {
              await appendFeeAudit({
                schoolId: req.session.schoolId!,
                actor: SYSTEM_FEE_AUDIT_ACTOR,
                action: state.action,
                entityType: "refund",
                entityId: state.refundId,
                studentId: context.studentId,
                studentName: context.studentName,
                sessionId: context.sessionId,
                recordLabel: context.invoiceNumber ?? `Payment ${context.paymentRecordId}`,
                eventKey: `refund:${state.refundId}:${state.action}`,
                amount: Math.round(state.amountPaise / 100),
                description: `Refund reservation for ${context.invoiceNumber ?? "the selected invoice"} was reconciled to an earlier payment-gateway update. No duplicate refund was created.`,
              }, tx);
            },
          },
        );
        return res.status(201).json({ refund, summary: reservation.summary, providerAcknowledged: true });
      } catch (providerError: any) {
        const ambiguous = ["ECONNABORTED", "ETIMEDOUT", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN"].includes(String(providerError?.code ?? ""))
          || !providerError?.response;
        if (ambiguous) {
          await markRefundReconciliationRequired(
            req.session.schoolId!,
            Number(reservation.refund.id),
            providerError,
            {
              afterUpdate: async (tx, context, state) => {
                await appendFeeAudit({
                  schoolId: req.session.schoolId!,
                  actor: SYSTEM_FEE_AUDIT_ACTOR,
                  action: state.action,
                  entityType: "refund",
                  entityId: state.refundId,
                  studentId: context.studentId,
                  studentName: context.studentName,
                  sessionId: context.sessionId,
                  recordLabel: context.invoiceNumber ?? `Payment ${context.paymentRecordId}`,
                  eventKey: `refund:${state.refundId}:${state.action}`,
                  amount: Math.round(state.amountPaise / 100),
                  description: `Refund outcome for ${context.invoiceNumber ?? "the selected invoice"} could not be confirmed and requires reconciliation.`,
                }, tx);
              },
            },
          );
        } else {
          await markRefundProviderFailure(
            req.session.schoolId!,
            Number(reservation.refund.id),
            providerError,
            {
              afterFailure: async (tx, context, state) => {
                await appendFeeAudit({
                  schoolId: req.session.schoolId!,
                  actor: RAZORPAY_FEE_AUDIT_ACTOR,
                  action: state.action,
                  entityType: "refund",
                  entityId: state.refundId,
                  studentId: context.studentId,
                  studentName: context.studentName,
                  sessionId: context.sessionId,
                  recordLabel: context.invoiceNumber ?? `Payment ${context.paymentRecordId}`,
                  eventKey: `refund:${state.refundId}:${state.action}`,
                  amount: Math.round(state.amountPaise / 100),
                  description: `Refund of ₹${(state.amountPaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })} was rejected for ${context.invoiceNumber ?? "the selected invoice"}. No refund was marked complete.`,
                }, tx);
              },
            },
          );
        }
        console.error("[refund create] provider request did not complete safely", providerError);
        return res.status(ambiguous ? 202 : 502).json({
          message: ambiguous
            ? "Refund request outcome is being reconciled. Do not submit it again."
            : "Razorpay rejected the refund request; it is retained for reconciliation.",
          refundId: reservation.refund.id,
          reconciliationRequired: true,
        });
      }
    } catch (err: any) {
      const message = err?.message ?? "Unable to create refund request.";
      const status = /not found/i.test(message) ? 404 : /captured|refundable|exceeds|amount|reason/i.test(message) ? 409 : 500;
      console.error("[refund create]", err);
      res.status(status).json({ message });
    }
  });

  app.get("/api/admin/fees/:id/transaction-detail", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const feeRecordId = parseInt(req.params.id);
    if (isNaN(feeRecordId)) return res.status(400).json({ message: "Invalid ID" });

    try {
      const detail = await loadTransactionDetailData(schoolId, feeRecordId);
      if (!detail) {
        return res.status(404).json({ message: "Fee record not found" });
      }
      return res.json(detail);
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
      const detail = await loadTransactionDetailData(schoolId, feeRecordId);
      if (!detail) {
        return res.status(404).send("Fee record not found");
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(
        renderTransactionAuditHtml(detail as unknown as TransactionAuditDetail),
      );
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
      if (!await activePaymentRecordGuard(res, schoolId, id)) return;
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

  // ── Professional Invoice HTML ────────────────────────────────────────────
  // The document is rendered server-side from canonical invoice data. This
  // status check happens at document generation time so paid invoices cannot
  // be newly downloaded through the active ledger actions.
  app.get("/api/admin/fees/:id/invoice", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    try {
      const result = await db.execute(sql`
        SELECT fr.*,
               s.name AS student_name, s.digital_student_id, s.class, s.section, s.guardian_name, s.phone AS student_phone,
               sch.name AS school_name, sch.logo_url AS school_logo_url,
               sch.address_line1 AS school_address_line1, sch.address_line2 AS school_address_line2,
               sch.city AS school_city, sch.state AS school_state, sch.pin_code AS school_pin_code,
               sch.country AS school_country, sch.phone AS school_phone, sch.email AS school_email,
               sch.affiliation_number AS school_affiliation_number, sch.gstin AS school_gstin
        FROM fee_records fr
        JOIN students s ON s.id = fr.student_id AND s.school_id = fr.school_id
        JOIN schools sch ON sch.id = fr.school_id
        WHERE fr.id = ${id} AND fr.school_id = ${schoolId}
        LIMIT 1
      `);
      const row = result.rows[0] as any;
      if (!row) return res.status(404).json({ message: "Invoice not found" });
      if (row.status !== "Due" && row.status !== "Overdue") {
        return res.status(409).type("html").send(`<!doctype html><title>Invoice unavailable</title><body style="font-family:Arial,sans-serif;padding:32px;color:#334155"><h1>Invoice unavailable</h1><p>This invoice is already paid. Use the payment receipt from the ledger instead.</p></body>`);
      }

      const relativeLogoUrl = row.school_logo_url as string | null;
      const logoUrl = relativeLogoUrl
        ? (/^https?:\/\//i.test(relativeLogoUrl)
          ? relativeLogoUrl
          : `${req.protocol}://${req.get("host")}${relativeLogoUrl}`)
        : null;

      // ── Authorized signature (tenant-scoped) ────────────────────────────────
      const invSigMeta = await storage.getSchoolMetadataRaw(schoolId, "fee_receipt_signature") as any;
      const invSigRelUrl =
        invSigMeta?.processedSignatureUrl ??
        invSigMeta?.originalSignatureUrl ??
        invSigMeta?.fileUrl ?? null;
      const invoiceSignatureUrl = invSigRelUrl
        ? (/^https?:\/\//i.test(invSigRelUrl)
          ? invSigRelUrl
          : `${req.protocol}://${req.get("host")}${invSigRelUrl}`)
        : null;
      // signatoryName is stored in school_metadata under "fee_signatory_name",
      // or falls back to null — never hardcoded.
      const invSignatoryMeta = await storage.getSchoolMetadataRaw(schoolId, "fee_signatory_name") as any;
      const invoiceSignatoryName: string | null =
        (typeof invSignatoryMeta === "string" && invSignatoryMeta.trim())
          ? invSignatoryMeta.trim()
          : (typeof invSignatoryMeta?.name === "string" && invSignatoryMeta.name.trim())
            ? invSignatoryMeta.name.trim()
            : null;

      const html = renderInvoiceDocument({
        invoiceNumber: row.invoice_number ?? null,
        status: row.status,
        createdAt: row.created_at,
        feeName: row.fee_name ?? row.fee_type,
        feeType: row.fee_type,
        amount: Number(row.amount),
        lateFeeAmount: Number(row.late_fee_amount ?? 0),
        frequency: row.frequency ?? null,
        feePeriodStart: row.fee_period_start ?? null,
        feePeriodEnd: row.fee_period_end ?? null,
        academicYear: row.academic_year ?? null,
        dueDate: row.due_date ?? null,
        notes: row.notes ?? null,
        breakdown: Array.isArray(row.breakdown_snapshot) ? row.breakdown_snapshot : [],
        lateFeeConfig: row.late_fee_config ?? null,
        student: {
          name: row.student_name,
          digitalStudentId: row.digital_student_id,
          guardianName: row.guardian_name ?? null,
          phone: row.student_phone ?? null,
          className: row.class,
          section: row.section,
        },
        school: {
          name: row.school_name,
          logoUrl,
          addressLine1: row.school_address_line1 ?? null,
          addressLine2: row.school_address_line2 ?? null,
          city: row.school_city ?? null,
          state: row.school_state ?? null,
          pinCode: row.school_pin_code ?? null,
          country: row.school_country ?? null,
          phone: row.school_phone ?? null,
          email: row.school_email ?? null,
          affiliationNumber: row.school_affiliation_number ?? null,
          gstin: row.school_gstin ?? null,
          signatureUrl: invoiceSignatureUrl,
          signatoryName: invoiceSignatoryName,
        },
      });
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Disposition", `inline; filename="invoice-${row.invoice_number ?? id}.html"`);
      res.send(html);
    } catch (error) {
      console.error("[invoice-document]", error);
      res.status(500).json({ message: "Unable to generate invoice document" });
    }
  });

  // ── Invoice — PDF download ────────────────────────────────────────────────
  app.get("/api/admin/fees/:id/invoice/pdf", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });

    try {
      const result = await db.execute(sql`
        SELECT fr.*,
               s.name AS student_name, s.digital_student_id, s.class, s.section, s.guardian_name, s.phone AS student_phone,
               sch.name AS school_name, sch.logo_url AS school_logo_url,
               sch.address_line1 AS school_address_line1, sch.address_line2 AS school_address_line2,
               sch.city AS school_city, sch.state AS school_state, sch.pin_code AS school_pin_code,
               sch.country AS school_country, sch.phone AS school_phone, sch.email AS school_email,
               sch.affiliation_number AS school_affiliation_number, sch.gstin AS school_gstin
        FROM fee_records fr
        JOIN students s ON s.id = fr.student_id AND s.school_id = fr.school_id
        JOIN schools sch ON sch.id = fr.school_id
        WHERE fr.id = ${id} AND fr.school_id = ${schoolId}
        LIMIT 1
      `);
      const row = result.rows[0] as any;
      if (!row) return res.status(404).json({ message: "Invoice not found" });
      if (row.status !== "Due" && row.status !== "Overdue") {
        return res.status(409).json({ message: "Invoice PDF only available for Due/Overdue invoices. Use the payment receipt for paid records." });
      }

      const relativeLogoUrl = row.school_logo_url as string | null;
      const logoUrl = relativeLogoUrl
        ? (/^https?:\/\//i.test(relativeLogoUrl) ? relativeLogoUrl : `${req.protocol}://${req.get("host")}${relativeLogoUrl}`)
        : null;

      const invSigMeta = await storage.getSchoolMetadataRaw(schoolId, "fee_receipt_signature") as any;
      const invSigRelUrl = invSigMeta?.processedSignatureUrl ?? invSigMeta?.originalSignatureUrl ?? invSigMeta?.fileUrl ?? null;
      const invoiceSignatureUrl = invSigRelUrl
        ? (/^https?:\/\//i.test(invSigRelUrl) ? invSigRelUrl : `${req.protocol}://${req.get("host")}${invSigRelUrl}`)
        : null;
      const invSignatoryMeta = await storage.getSchoolMetadataRaw(schoolId, "fee_signatory_name") as any;
      const invoiceSignatoryName: string | null =
        (typeof invSignatoryMeta === "string" && invSignatoryMeta.trim()) ? invSignatoryMeta.trim()
        : (typeof invSignatoryMeta?.name === "string" && invSignatoryMeta.name.trim()) ? invSignatoryMeta.name.trim()
        : null;

      const invoiceNo = (row.invoice_number as string | null) ?? `fee-${id}`;
      const pdfBuffer = await renderInvoicePdf({
        invoiceNumber: row.invoice_number ?? null,
        status: row.status,
        createdAt: row.created_at,
        feeName: row.fee_name ?? row.fee_type,
        feeType: row.fee_type,
        amount: Number(row.amount),
        lateFeeAmount: Number(row.late_fee_amount ?? 0),
        frequency: row.frequency ?? null,
        feePeriodStart: row.fee_period_start ?? null,
        feePeriodEnd: row.fee_period_end ?? null,
        academicYear: row.academic_year ?? null,
        dueDate: row.due_date ?? null,
        notes: row.notes ?? null,
        breakdown: Array.isArray(row.breakdown_snapshot) ? row.breakdown_snapshot : [],
        lateFeeConfig: row.late_fee_config ?? null,
        student: {
          name: row.student_name, digitalStudentId: row.digital_student_id,
          guardianName: row.guardian_name ?? null, phone: row.student_phone ?? null,
          className: row.class, section: row.section,
        },
        school: {
          name: row.school_name, logoUrl,
          addressLine1: row.school_address_line1 ?? null, addressLine2: row.school_address_line2 ?? null,
          city: row.school_city ?? null, state: row.school_state ?? null, pinCode: row.school_pin_code ?? null,
          country: row.school_country ?? null, phone: row.school_phone ?? null, email: row.school_email ?? null,
          affiliationNumber: row.school_affiliation_number ?? null, gstin: row.school_gstin ?? null,
          signatureUrl: invoiceSignatureUrl, signatoryName: invoiceSignatoryName,
        },
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="Invoice-${invoiceNo}.pdf"`);
      res.send(pdfBuffer);
    } catch (error) {
      console.error("[invoice-pdf]", error);
      res.status(500).json({ message: "Unable to generate invoice PDF" });
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

    try {
      // ── Fee record + student ────────────────────────────────────────────────
      const feeRow = (await db.execute(sql`
        SELECT fr.*, s.name AS student_name, s.digital_student_id,
               s.class AS student_class, s.section AS student_section,
               s.roll_number, s.guardian_name, s.phone AS student_phone,
               s.email AS student_email
        FROM fee_records fr
        JOIN students s ON s.id = fr.student_id AND s.school_id = fr.school_id
        WHERE fr.id = ${id} AND fr.school_id = ${schoolId}
        LIMIT 1
      `)).rows[0] as any;
      if (!feeRow) return res.status(404).json({ message: "Fee record not found" });
      if (feeRow.status !== "Paid") {
        return res.status(400).json({ message: "Receipt only available for paid records" });
      }

      // ── Full school data ────────────────────────────────────────────────────
      const schoolRow = (await db.execute(sql`
        SELECT name, logo_url, address_line1, address_line2, city, state, pin_code,
               phone, email, affiliation_number, gstin
        FROM schools WHERE id = ${schoolId} LIMIT 1
      `)).rows[0] as any;

      // ── Primary payment record (most recent, for amount + method) ──────────
      const payRow = (await db.execute(sql`
        SELECT pr.*,
               COALESCE(t.full_name, nts.full_name) AS recorded_by_display_name,
               u.email AS recorded_by_email,
               u.role  AS recorded_by_role
        FROM payment_records pr
        LEFT JOIN users u ON u.id = pr.recorded_by
        LEFT JOIN teachers t ON t.user_id = u.id AND t.school_id = u.school_id
        LEFT JOIN non_teaching_staff nts ON nts.email = u.email AND nts.school_id = u.school_id
        WHERE pr.fee_record_id = ${id} AND pr.school_id = ${schoolId}
        ORDER BY pr.created_at DESC
        LIMIT 1
      `)).rows[0] as any;

      // ── Provider timestamps from captured payment_attempt ──────────────────
      const attemptRow = (await db.execute(sql`
        SELECT pa.rzp_created_at, pa.rzp_captured_at,
               pa.payment_method AS rzp_method, pa.card_network
        FROM payment_attempts pa
        WHERE pa.fee_record_id = ${id}
          AND pa.school_id = ${schoolId}
          AND pa.outcome = 'captured'
        ORDER BY pa.created_at DESC
        LIMIT 1
      `)).rows[0] as any;

      // ── Offline payment details sidecar ────────────────────────────────────
      const odRow = payRow ? (await db.execute(sql`
        SELECT transaction_time, instrument_status, transfer_mode, transaction_reference,
               receiving_bank, receiver_upi_id, payee_name, payable_at, collection_location,
               deposit_date, deposit_bank, deposit_reference, return_date, return_reason
        FROM offline_payment_details
        WHERE school_id = ${schoolId} AND payment_record_id = ${payRow.id}
        LIMIT 1
      `)).rows[0] as any : null;

      // ── Academic session label ─────────────────────────────────────────────
      let sessionLabel: string | null = null;
      const sessionId = feeRow.session_id ?? null;
      if (sessionId) {
        const sess = (await db.execute(sql`
          SELECT session_name FROM academic_sessions WHERE id = ${sessionId} LIMIT 1
        `)).rows[0] as any;
        sessionLabel = sess?.session_name ?? null;
      }

      // ── Signature ──────────────────────────────────────────────────────────
      const sigMeta = await storage.getSchoolMetadataRaw(schoolId, "fee_receipt_signature") as any;
      const sigRelUrl = sigMeta?.processedSignatureUrl ?? sigMeta?.originalSignatureUrl ?? sigMeta?.fileUrl ?? null;
      const sigUrl = sigRelUrl
        ? (/^https?:\/\//i.test(sigRelUrl) ? sigRelUrl : `${req.protocol}://${req.get("host")}${sigRelUrl}`)
        : null;
      const signatoryMeta = await storage.getSchoolMetadataRaw(schoolId, "fee_signatory_name") as any;
      const signatoryName: string | null =
        (typeof signatoryMeta === "string" && signatoryMeta.trim()) ? signatoryMeta.trim()
        : (typeof signatoryMeta?.name === "string" && signatoryMeta.name.trim()) ? signatoryMeta.name.trim()
        : null;

      // ── School logo absolute URL ───────────────────────────────────────────
      const logoRelUrl = schoolRow?.logo_url ?? null;
      const logoUrl = logoRelUrl
        ? (/^https?:\/\//i.test(logoRelUrl) ? logoRelUrl : `${req.protocol}://${req.get("host")}${logoRelUrl}`)
        : null;

      // ── Payment datetime — prefer provider capture, then payment record ────
      const paymentInstant = attemptRow?.rzp_captured_at ?? payRow?.created_at ?? null;

      // ── Build ReceiptData ──────────────────────────────────────────────────
      const receiptData: ReceiptData = {
        school: {
          name: schoolRow?.name ?? "School",
          logoUrl,
          addressLine1: schoolRow?.address_line1 ?? null,
          addressLine2: schoolRow?.address_line2 ?? null,
          city: schoolRow?.city ?? null,
          state: schoolRow?.state ?? null,
          pinCode: schoolRow?.pin_code ?? null,
          phone: schoolRow?.phone ?? null,
          email: schoolRow?.email ?? null,
          affiliationNumber: schoolRow?.affiliation_number ?? null,
          gstin: schoolRow?.gstin ?? null,
        },
        student: {
          name: feeRow.student_name,
          digitalStudentId: feeRow.digital_student_id,
          rollNumber: feeRow.roll_number ?? null,
          class: feeRow.student_class,
          section: feeRow.student_section,
          guardianName: feeRow.guardian_name ?? null,
          phone: feeRow.student_phone ?? null,
          email: feeRow.student_email ?? null,
        },
        fee: {
          feeType: feeRow.fee_type,
          feeName: feeRow.fee_name ?? feeRow.fee_type,
          invoiceNumber: feeRow.invoice_number ?? null,
          academicYear: feeRow.academic_year ?? null,
          feePeriodStart: feeRow.fee_period_start ? formatDateOnly(String(feeRow.fee_period_start).slice(0, 10)) : null,
          feePeriodEnd: feeRow.fee_period_end ? formatDateOnly(String(feeRow.fee_period_end).slice(0, 10)) : null,
          dueDate: feeRow.due_date ? formatDateOnly(String(feeRow.due_date).slice(0, 10)) : null,
          amount: Number(feeRow.amount ?? 0),
          lateFeeAmount: Number(feeRow.late_fee_amount ?? 0),
          breakdown: Array.isArray(feeRow.breakdown_snapshot) ? feeRow.breakdown_snapshot : [],
          notes: feeRow.notes ?? null,
        },
        payment: {
          receiptNumber: feeRow.receipt_number ?? payRow?.receipt_number ?? null,
          amount: Number(payRow?.amount ?? feeRow.amount ?? 0),
          lateFeePaid: Number(payRow?.late_fee_paid ?? 0),
          paymentMethod: normalizePaymentMethod(payRow?.payment_method ?? "Portal Payment") ?? "Portal Payment",
          receivedDate: payRow?.received_date
            ? String(payRow.received_date).slice(0, 10)
            : (feeRow.paid_date ? String(feeRow.paid_date).slice(0, 10) : "—"),
          paymentDateTimeIST: formatInstantIST(paymentInstant),
          cashierNotes: payRow?.cashier_notes ?? null,
          // Online
          razorpayPaymentId: payRow?.razorpay_payment_id ?? null,
          razorpayOrderId: payRow?.razorpay_order_id ?? null,
          paymentMode: payRow?.payment_mode ?? null,
          bankName: payRow?.bank_name ?? null,
          cardLast4: payRow?.card_last4 ?? null,
          cardNetwork: attemptRow?.card_network ?? null,
          vpa: payRow?.vpa ?? null,
          payerName: payRow?.payer_name ?? null,
          payerEmail: payRow?.payer_email ?? null,
          payerContact: payRow?.payer_contact ?? null,
          gatewayStatus: payRow?.gateway_status ?? null,
          providerCreatedIST: attemptRow?.rzp_created_at ? formatInstantIST(attemptRow.rzp_created_at) : null,
          providerCapturedIST: attemptRow?.rzp_captured_at ? formatInstantIST(attemptRow.rzp_captured_at) : null,
          // Offline
          denominationBreakdown: payRow?.denomination_breakdown ?? null,
          referenceNumber: payRow?.reference_number ?? null,
          instrumentDate: payRow?.cheque_date ? formatDateOnly(String(payRow.cheque_date).slice(0, 10)) : null,
          branchName: payRow?.branch_name ?? null,
          offlineDetail: odRow ? {
            transactionTime: odRow.transaction_time ?? null,
            instrumentStatus: odRow.instrument_status ?? null,
            transferMode: odRow.transfer_mode ?? null,
            transactionReference: odRow.transaction_reference ?? null,
            receivingBank: odRow.receiving_bank ?? null,
            receiverUpiId: odRow.receiver_upi_id ?? null,
            payeeName: odRow.payee_name ?? null,
            payableAt: odRow.payable_at ?? null,
            collectionLocation: odRow.collection_location ?? null,
            depositDate: odRow.deposit_date ?? null,
            depositBank: odRow.deposit_bank ?? null,
            depositReference: odRow.deposit_reference ?? null,
            returnDate: odRow.return_date ?? null,
            returnReason: odRow.return_reason ?? null,
          } : null,
          // Never fall back to email — "School Finance Office" is the renderer's fallback
          recordedByName: payRow?.recorded_by_display_name ?? null,
          recordedByRole: payRow?.recorded_by_role ?? null,
        },
        signature: { imageUrl: sigUrl, signatoryName },
        academicSessionLabel: sessionLabel,
        generatedAtIST: formatInstantIST(new Date()),
      };

      // ── Cash denomination integrity check ──────────────────────────────────
      if (payRow?.payment_method === "Cash" && payRow?.denomination_breakdown) {
        const breakdown = payRow.denomination_breakdown as Record<string, number>;
        const denomTotal = Object.entries(breakdown)
          .filter(([, qty]) => Number(qty) > 0)
          .reduce((sum, [denom, qty]) => sum + Number(denom) * Number(qty), 0);
        const paidAmount = Number(payRow.amount ?? 0);
        if (Math.abs(denomTotal - paidAmount) > 0.01) {
          return res.status(400).json({
            message: `Cash denomination total (₹${denomTotal.toLocaleString("en-IN")}) does not match the recorded payment amount (₹${paidAmount.toLocaleString("en-IN")}). Receipt cannot be generated until the denomination record is corrected.`,
          });
        }
      }

      const html = renderReceiptHtml(receiptData);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Content-Disposition", `inline; filename="fee-receipt-${id}.html"`);
      res.send(html);
    } catch (err) {
      console.error("[fee receipt]", err);
      res.status(500).json({ message: String(err) });
    }
  });

  // ── School-wide Ledger Export (CSV) — GET (filter-only) + POST (selection-aware) ─
  //
  // Shared query helper — both GET and POST routes call this.
  //
  // The filter map, session condition, and tenant guards are identical for both
  // routes. The only difference is the optional selection restriction applied
  // after the base predicates: either an explicit IN-list or an exclusion list.
  //
  // IDs in selectedIds/excludedIds MUST be pre-validated positive integers by
  // the caller before they reach sql.raw(); the POST handler enforces this.
  async function runLedgerCsvQuery(
    schoolId: number,
    sessionFilter: number | null,
    csvFilters: ReturnType<typeof normalizeLedgerFiltersFromQuery>,
    selection?: { selectAllMatching: boolean; selectedIds: number[]; excludedIds: number[] },
  ): Promise<any[]> {
    const fieldMap: LedgerFilterFields = {
      invoiceNumber:     sql`COALESCE(fr.invoice_number, '')`,
      receiptNumber:     sql`COALESCE(fr.receipt_number, '')`,
      studentName:       sql`COALESCE(s.name, '')`,
      dsid:              sql`COALESCE(s.digital_student_id, '')`,
      class:             sql`s.class`,
      section:           sql`s.section`,
      feeName:           sql`COALESCE(fr.fee_name, structure.fee_name, fr.fee_type)`,
      feeType:           sql`fr.fee_type`,
      feePeriodStartEnd: [sql`fr.fee_period_start`, sql`fr.fee_period_end`],
      frequency:         sql`fr.frequency`,
      status:            sql`fr.status`,
      paymentMethod:     sql`lp.raw_payment_method`,
      academicYear:      sql`fr.academic_year`,
      amount:            sql`fr.amount`,
      dueDate:           sql`fr.due_date`,
      referenceNumber:   sql`COALESCE(lp.raw_reference_number, '')`,
    };

    const predicates   = buildLedgerFilterPredicates(csvFilters, fieldMap);
    const paymentDatePredicate = buildLedgerPaymentDatePredicate(csvFilters, {
      schoolId: sql`fr.school_id`,
      feeRecordId: sql`fr.id`,
    });
    if (paymentDatePredicate) predicates.push(paymentDatePredicate);
    // Callers normally reject a missing scope. Keep this helper fail-closed too
    // so a future caller cannot accidentally export every historical session.
    const sessionCond  = sessionFilter != null ? sql`AND fr.session_id = ${sessionFilter}` : sql`AND FALSE`;
    const extraWhere   = predicates.length > 0
      ? sql`AND ${sql.join(predicates, sql` AND `)}`
      : sql``;

    const { selectAllMatching = false, selectedIds = [], excludedIds = [] } = selection ?? {};
    // IDs are pre-validated positive integers — sql.raw is safe here.
    const selectedArr = selectedIds.length
      ? sql.raw(`ARRAY[${selectedIds.join(",")}]::int[]`) : null;
    const excludedArr = excludedIds.length
      ? sql.raw(`ARRAY[${excludedIds.join(",")}]::int[]`) : null;
    const selCond1 = !selectAllMatching && selectedArr
      ? sql`AND fr.id = ANY(${selectedArr})` : sql``;
    const selCond2 =  selectAllMatching && excludedArr
      ? sql`AND fr.id != ALL(${excludedArr})` : sql``;

    // One row per fee record; amounts in rupees. Always scoped to the viewed session.
    //   structure → deterministic first fee-structure name (no one-to-many duplication)
    //   p         → aggregated payments for total_paid / outstanding
    //   lp        → latest NON-auto-recorded payment for method/reference display + filter
    const result = await db.execute(sql`
      SELECT
        fr.invoice_number    AS invoice_number,
        fr.receipt_number    AS receipt_number,
        s.name               AS student_name,
        s.digital_student_id AS student_id,
        s.class              AS class,
        s.section            AS section,
        COALESCE(fr.fee_name, structure.fee_name, fr.fee_type) AS fee_name,
        fr.fee_type          AS fee_type,
        fr.frequency         AS frequency,
        fr.amount            AS invoice_amount,
        COALESCE(p.total_paid, 0)::int                          AS amount_paid,
        GREATEST(fr.amount - COALESCE(p.total_paid, 0), 0)::int AS outstanding,
        fr.status            AS status,
        fr.due_date          AS due_date,
        COALESCE((
          SELECT MAX(ledger_paid_date.received_date)
          FROM payment_records ledger_paid_date
          WHERE ledger_paid_date.school_id = fr.school_id
            AND ledger_paid_date.fee_record_id = fr.id
        ), fr.paid_date) AS paid_date,
        fr.academic_year     AS academic_year,
        lp.raw_payment_method    AS payment_method,
        lp.raw_reference_number  AS reference_number,
        fr.notes             AS notes,
        fr.fee_period_start  AS fee_period_start,
        fr.fee_period_end    AS fee_period_end
      FROM fee_records fr
      LEFT JOIN students s ON s.id = fr.student_id AND s.school_id = fr.school_id
      LEFT JOIN LATERAL (
        SELECT fs.name AS fee_name
        FROM fee_structures fs
        WHERE fs.school_id = fr.school_id
          AND lower(trim(fs.fee_type)) = lower(trim(fr.fee_type))
        ORDER BY fs.id ASC
        LIMIT 1
      ) structure ON true
      LEFT JOIN (
        SELECT
          fee_record_id,
          SUM(amount)::int AS total_paid
        FROM payment_records
        WHERE school_id = ${schoolId}
          AND fee_record_id IS NOT NULL
        GROUP BY fee_record_id
      ) p ON p.fee_record_id = fr.id
      LEFT JOIN LATERAL (
        SELECT pr.payment_method    AS raw_payment_method,
               pr.reference_number AS raw_reference_number
        FROM payment_records pr
        WHERE pr.school_id    = fr.school_id
          AND pr.fee_record_id = fr.id
          AND (pr.cashier_notes IS NULL OR pr.cashier_notes <> 'Auto-recorded from Add Fee Record')
        ORDER BY pr.created_at DESC, pr.id DESC
        LIMIT 1
      ) lp ON true
      WHERE fr.school_id = ${schoolId}
        ${sessionCond}
        ${extraWhere}
        ${selCond1}
        ${selCond2}
      ORDER BY s.class, s.name, fr.due_date
    `);
    return result.rows as any[];
  }

  /** Shared CSV formatter — identical columns for GET and POST. */
  function buildLedgerCsvBuffer(rows: any[]): string {
    const esc = (v: string | null | undefined) => {
      const s = v == null ? "" : String(v);
      return `"${s.replace(/"/g, '""')}"`;
    };
    const fmtDate = (d: string | null | undefined) => {
      if (!d) return "";
      const formatted = formatDateOnly(String(d).slice(0, 10));
      return formatted === "—" ? String(d) : formatted;
    };

    // 20 columns — aligns with Ledger PDF order, adds Invoice No., Fee Period, Frequency.
    const headers = [
      "Invoice No.",
      "Receipt No.",
      "Student Name", "Student ID",
      "Class", "Section",
      "Fee Name", "Fee Type",
      "Fee Period", "Frequency",
      "Invoice Amount (₹)",
      "Due Date",
      "Status",
      "Latest Payment On",
      "Acad. Year",
      "Notes",
      "Amount Paid (₹)", "Outstanding (₹)",
      "Payment Method", "Reference No.",
    ];

    const dataRows = rows.map(r => [
      esc(r.invoice_number),
      esc(r.receipt_number),
      esc(r.student_name),
      esc(r.student_id),
      esc(r.class),
      esc(r.section),
      esc(r.fee_name),
      esc(r.fee_type),
      esc(feePeriodLabel(r.fee_period_start, r.fee_period_end, r.academic_year)),
      esc(r.frequency),
      esc(r.invoice_amount),
      esc(fmtDate(r.due_date)),
      esc(r.status),
      esc(fmtDate(r.paid_date)),
      esc(r.academic_year),
      esc(r.notes),
      esc(r.amount_paid),
      esc(r.outstanding),
      esc(normalizePaymentMethod(r.payment_method) ?? r.payment_method),
      esc(r.reference_number),
    ].join(","));

    return [headers.map(h => `"${h}"`).join(","), ...dataRows].join("\r\n");
  }

  /** Set CSV response headers and send body (BOM for Excel UTF-8). */
  function sendLedgerCsvResponse(res: any, csv: string) {
    const dateTag = todayInIST();
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="payment-ledger-${dateTag}.csv"`);
    res.send("\uFEFF" + csv);
  }

  // GET — no selection; all filters come from query string.
  app.get("/api/admin/fees/export-ledger", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId    = req.session.schoolId!;
    const sessionFilter = await resolveFeeViewSession(req, res, schoolId);
    if (sessionFilter === undefined) return;
    if (sessionFilter === null) return res.status(409).json({ message: "No academic session selected or active." });
    const csvFilters  = normalizeLedgerFiltersFromQuery(req.query as Record<string, unknown>);
    try {
      const rows = await runLedgerCsvQuery(schoolId, sessionFilter, csvFilters);
      sendLedgerCsvResponse(res, buildLedgerCsvBuffer(rows));
    } catch (err) {
      console.error("[export-ledger-get]", err);
      res.status(500).json({ message: String(err) });
    }
  });

  // POST — selection-aware export. Accepts the same canonical LedgerFilters
  // (flat in the body, same shape as Ledger PDF POST) plus selection fields:
  //   selectAllMatching: boolean
  //   selectedIds:       number[]  — explicit invoice IDs (when selectAllMatching = false)
  //   excludedIds:       number[]  — IDs to skip     (when selectAllMatching = true)
  //
  // Security: schoolId + session always come from the server session; selection
  // fields are an additional restriction, never a bypass for tenant/session guards.
  // The archived-session write guard is exempted for this route in checkSessionContext
  // (same as Ledger PDF POST and Transaction Report PDF POST).
  app.post("/api/admin/fees/export-ledger", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId    = req.session.schoolId!;
    const sessionFilter = await resolveFeeViewSession(req, res, schoolId);
    if (sessionFilter === undefined) return;
    if (sessionFilter === null) return res.status(409).json({ message: "No academic session selected or active." });

    const {
      selectAllMatching: rawSelectAll,
      selectedIds:       rawSelectedIds,
      excludedIds:       rawExcludedIds,
    } = req.body as {
      selectAllMatching?: boolean; selectedIds?: number[]; excludedIds?: number[];
    };

    // Sanitize — accept only valid positive integers; ignore anything else.
    const selectAllMatching = rawSelectAll === true;
    const selectedIds = Array.isArray(rawSelectedIds)
      ? rawSelectedIds.filter(x => Number.isInteger(x) && x > 0)
      : [];
    const excludedIds = Array.isArray(rawExcludedIds)
      ? rawExcludedIds.filter(x => Number.isInteger(x) && x > 0)
      : [];

    const csvFilters = normalizeLedgerFiltersFromBody(req.body as Record<string, unknown>);
    try {
      const rows = await runLedgerCsvQuery(
        schoolId, sessionFilter, csvFilters,
        { selectAllMatching, selectedIds, excludedIds },
      );
      sendLedgerCsvResponse(res, buildLedgerCsvBuffer(rows));
    } catch (err) {
      console.error("[export-ledger-post]", err);
      res.status(500).json({ message: String(err) });
    }
  });

  // ── School-wide Ledger — PDF download ────────────────────────────────────
  app.get("/api/admin/fees/ledger/pdf", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const sessionFilter = await resolveFeeViewSession(req, res, schoolId);
    if (sessionFilter === undefined) return;
    if (sessionFilter === null) return res.status(409).json({ message: "No academic session selected or active." });

    // Normalize all ledger filters from query string.
    const ledgerGetFilters = normalizeLedgerFiltersFromQuery(req.query as Record<string, unknown>);

    try {
      const ledgerGetFields: LedgerFilterFields = {
        invoiceNumber:  sql`COALESCE(fr.invoice_number, '')`,
        receiptNumber:  sql`COALESCE(fr.receipt_number, '')`,
        studentName:    sql`COALESCE(s.name, '')`,
        dsid:           sql`COALESCE(s.digital_student_id, '')`,
        class:          sql`s.class`,
        section:        sql`s.section`,
        feeName:        sql`COALESCE(fr.fee_name, structure.fee_name, fr.fee_type)`,
        feeType:        sql`fr.fee_type`,
        feePeriodStartEnd: [sql`fr.fee_period_start`, sql`fr.fee_period_end`],
        frequency:      sql`fr.frequency`,
        status:         sql`fr.status`,
        paymentMethod:  sql`lp.raw_payment_method`,
        academicYear:   sql`fr.academic_year`,
        amount:         sql`fr.amount`,
        dueDate:        sql`fr.due_date`,
        referenceNumber: sql`COALESCE(lp.raw_reference_number, '')`,
      };
      const ledgerGetPreds = buildLedgerFilterPredicates(ledgerGetFilters, ledgerGetFields);
      const ledgerGetPaymentDatePredicate = buildLedgerPaymentDatePredicate(ledgerGetFilters, {
        schoolId: sql`fr.school_id`,
        feeRecordId: sql`fr.id`,
      });
      if (ledgerGetPaymentDatePredicate) ledgerGetPreds.push(ledgerGetPaymentDatePredicate);
      const ledgerGetSessionCond = sql`AND fr.session_id = ${sessionFilter}`;
      const ledgerGetExtraWhere = ledgerGetPreds.length > 0
        ? sql`AND ${sql.join(ledgerGetPreds, sql` AND `)}`
        : sql``;

      // structure → deterministic first fee-structure name (no one-to-many duplication)
      // p         → aggregated payments for total_paid / outstanding (UNCHANGED)
      // lp        → latest NON-auto-recorded payment for method/reference display + filter
      const rows = await db.execute(sql`
        SELECT
          fr.invoice_number    AS invoice_number,
          fr.receipt_number    AS receipt_number,
          s.name               AS student_name,
          s.digital_student_id AS student_id,
          s.class              AS class,
          s.section            AS section,
          COALESCE(fr.fee_name, structure.fee_name, fr.fee_type) AS fee_name,
          fr.fee_type          AS fee_type,
          fr.frequency         AS frequency,
          fr.amount            AS invoice_amount,
          COALESCE(p.total_paid, 0)::int                          AS amount_paid,
          GREATEST(fr.amount - COALESCE(p.total_paid, 0), 0)::int AS outstanding,
          fr.status            AS status,
          fr.due_date          AS due_date,
          COALESCE((
            SELECT MAX(ledger_paid_date.received_date)
            FROM payment_records ledger_paid_date
            WHERE ledger_paid_date.school_id = fr.school_id
              AND ledger_paid_date.fee_record_id = fr.id
          ), fr.paid_date) AS paid_date,
          fr.academic_year     AS academic_year,
          lp.raw_payment_method    AS payment_method,
          lp.raw_reference_number  AS reference_number,
          fr.notes             AS notes,
          fr.fee_period_start  AS fee_period_start,
          fr.fee_period_end    AS fee_period_end
        FROM fee_records fr
        LEFT JOIN students s ON s.id = fr.student_id AND s.school_id = fr.school_id
        LEFT JOIN LATERAL (
          SELECT fs.name AS fee_name
          FROM fee_structures fs
          WHERE fs.school_id = fr.school_id
            AND lower(trim(fs.fee_type)) = lower(trim(fr.fee_type))
          ORDER BY fs.id ASC
          LIMIT 1
        ) structure ON true
        LEFT JOIN (
          SELECT
            fee_record_id,
            SUM(amount)::int AS total_paid
          FROM payment_records
          WHERE school_id = ${schoolId} AND fee_record_id IS NOT NULL
          GROUP BY fee_record_id
        ) p ON p.fee_record_id = fr.id
        LEFT JOIN LATERAL (
          SELECT pr.payment_method AS raw_payment_method,
                 pr.reference_number AS raw_reference_number
          FROM payment_records pr
          WHERE pr.school_id = fr.school_id
            AND pr.fee_record_id = fr.id
            AND (pr.cashier_notes IS NULL OR pr.cashier_notes <> 'Auto-recorded from Add Fee Record')
          ORDER BY pr.created_at DESC, pr.id DESC
          LIMIT 1
        ) lp ON true
        WHERE fr.school_id = ${schoolId}
          ${ledgerGetSessionCond}
          ${ledgerGetExtraWhere}
        ORDER BY s.class, s.name, fr.due_date
      `);

      const schoolRow = (await db.execute(sql`
        SELECT name, logo_url, address_line1, address_line2, city, state, pin_code, phone, email
        FROM schools WHERE id = ${schoolId} LIMIT 1
      `)).rows[0] as any;

      let sessionLabel: string | null = null;
      if (sessionFilter) {
        const sess = (await db.execute(sql`
          SELECT session_name FROM academic_sessions WHERE id = ${sessionFilter} LIMIT 1
        `)).rows[0] as any;
        sessionLabel = sess?.session_name ?? null;
      }

      const logoRelUrl = schoolRow?.logo_url ?? null;
      const logoUrl = logoRelUrl
        ? (/^https?:\/\//i.test(logoRelUrl) ? logoRelUrl : `${req.protocol}://${req.get("host")}${logoRelUrl}`)
        : null;

      // Backward-compatible renderer metadata: summarize first selected value or joined labels.
      const pdfBuffer = await renderLedgerPdf({
        school: {
          name: schoolRow?.name ?? "School", logoUrl,
          addressLine1: schoolRow?.address_line1 ?? null,
          addressLine2: schoolRow?.address_line2 ?? null,
          city: schoolRow?.city ?? null, state: schoolRow?.state ?? null,
          pinCode: schoolRow?.pin_code ?? null,
          phone: schoolRow?.phone ?? null, email: schoolRow?.email ?? null,
        },
        sessionLabel,
        filters: {
          search:   ledgerGetFilters.search   || undefined,
          status:   firstLedgerFilterValue(ledgerGetFilters.statuses),
          class:    firstLedgerFilterValue(ledgerGetFilters.classes),
          feeName:  joinedLedgerFilterLabel(ledgerGetFilters.feeNames),
          feeType:  firstLedgerFilterValue(ledgerGetFilters.feeTypes),
          dateFrom: ledgerGetFilters.dueDateFrom  || undefined,
          dateTo:   ledgerGetFilters.dueDateTo    || undefined,
        },
        rows: (rows.rows as any[]) as LedgerRow[],
        generatedAtIST: formatInstantIST(new Date()),
      });

      const sessionTag = sessionLabel ? sessionLabel.replace(/[^a-zA-Z0-9-]/g, "-") : todayInIST();
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="Fee-Ledger-${sessionTag}.pdf"`);
      res.send(pdfBuffer);
    } catch (err) {
      console.error("[ledger-pdf]", err);
      res.status(500).json({ message: String(err) });
    }
  });

  // ── School-wide Ledger — PDF download (POST — selection-aware) ────────────
  // Accepts the same filters as the GET endpoint plus:
  //   selectAllMatching: boolean  — true = all matching records (minus excludedIds)
  //   selectedIds: number[]       — explicit invoice IDs (when selectAllMatching = false)
  //   excludedIds: number[]       — IDs to carve out when selectAllMatching = true
  //
  // Security: school_id + session are always enforced server-side regardless of
  // what IDs the browser sends. All existing filters also remain active.
  app.post("/api/admin/fees/ledger/pdf", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const sessionFilter = await resolveFeeViewSession(req, res, schoolId);
    if (sessionFilter === undefined) return;
    if (sessionFilter === null) return res.status(409).json({ message: "No academic session selected or active." });

    // Extract selection predicates (typed integer arrays — unchanged logic).
    const {
      selectAllMatching: rawSelectAll,
      selectedIds:       rawSelectedIds,
      excludedIds:       rawExcludedIds,
    } = req.body as {
      selectAllMatching?: boolean; selectedIds?: number[]; excludedIds?: number[];
    };

    // Sanitize — only accept valid integer arrays; ignore anything else.
    const selectAllMatching = rawSelectAll === true;
    const selectedIds = Array.isArray(rawSelectedIds)
      ? rawSelectedIds.filter(x => Number.isInteger(x) && x > 0)
      : [];
    const excludedIds = Array.isArray(rawExcludedIds)
      ? rawExcludedIds.filter(x => Number.isInteger(x) && x > 0)
      : [];

    // PostgreSQL's ANY/ALL operators require a PostgreSQL array expression on
    // the right-hand side. IDs above are validated positive integers before
    // constructing the project's existing typed ARRAY[...]::int[] expression.
    const selectedIdsArray = selectedIds.length
      ? sql.raw(`ARRAY[${selectedIds.join(",")}]::int[]`)
      : null;
    const excludedIdsArray = excludedIds.length
      ? sql.raw(`ARRAY[${excludedIds.join(",")}]::int[]`)
      : null;

    // Normalize ledger filters from body (same old-singular-field compat).
    const ledgerPostFilters = normalizeLedgerFiltersFromBody(req.body as Record<string, unknown>);

    try {
      const ledgerPostFields: LedgerFilterFields = {
        invoiceNumber:  sql`COALESCE(fr.invoice_number, '')`,
        receiptNumber:  sql`COALESCE(fr.receipt_number, '')`,
        studentName:    sql`COALESCE(s.name, '')`,
        dsid:           sql`COALESCE(s.digital_student_id, '')`,
        class:          sql`s.class`,
        section:        sql`s.section`,
        feeName:        sql`COALESCE(fr.fee_name, structure.fee_name, fr.fee_type)`,
        feeType:        sql`fr.fee_type`,
        feePeriodStartEnd: [sql`fr.fee_period_start`, sql`fr.fee_period_end`],
        frequency:      sql`fr.frequency`,
        status:         sql`fr.status`,
        paymentMethod:  sql`lp.raw_payment_method`,
        academicYear:   sql`fr.academic_year`,
        amount:         sql`fr.amount`,
        dueDate:        sql`fr.due_date`,
        referenceNumber: sql`COALESCE(lp.raw_reference_number, '')`,
      };
      const ledgerPostPreds = buildLedgerFilterPredicates(ledgerPostFilters, ledgerPostFields);
      const ledgerPostPaymentDatePredicate = buildLedgerPaymentDatePredicate(ledgerPostFilters, {
        schoolId: sql`fr.school_id`,
        feeRecordId: sql`fr.id`,
      });
      if (ledgerPostPaymentDatePredicate) ledgerPostPreds.push(ledgerPostPaymentDatePredicate);
      const ledgerPostSessionCond = sql`AND fr.session_id = ${sessionFilter}`;
      const ledgerPostExtraWhere = ledgerPostPreds.length > 0
        ? sql`AND ${sql.join(ledgerPostPreds, sql` AND `)}`
        : sql``;

      // structure → deterministic first fee-structure name (no one-to-many duplication)
      // p         → aggregated payments for total_paid / outstanding (UNCHANGED)
      // lp        → latest NON-auto-recorded payment for method/reference display + filter
      const rows = await db.execute(sql`
        SELECT
          fr.invoice_number    AS invoice_number,
          fr.receipt_number    AS receipt_number,
          s.name               AS student_name,
          s.digital_student_id AS student_id,
          s.class              AS class,
          s.section            AS section,
          COALESCE(fr.fee_name, structure.fee_name, fr.fee_type) AS fee_name,
          fr.fee_type          AS fee_type,
          fr.frequency         AS frequency,
          fr.amount            AS invoice_amount,
          COALESCE(p.total_paid, 0)::int                          AS amount_paid,
          GREATEST(fr.amount - COALESCE(p.total_paid, 0), 0)::int AS outstanding,
          fr.status            AS status,
          fr.due_date          AS due_date,
          COALESCE((
            SELECT MAX(ledger_paid_date.received_date)
            FROM payment_records ledger_paid_date
            WHERE ledger_paid_date.school_id = fr.school_id
              AND ledger_paid_date.fee_record_id = fr.id
          ), fr.paid_date) AS paid_date,
          fr.academic_year     AS academic_year,
          lp.raw_payment_method    AS payment_method,
          lp.raw_reference_number  AS reference_number,
          fr.notes             AS notes,
          fr.fee_period_start  AS fee_period_start,
          fr.fee_period_end    AS fee_period_end
        FROM fee_records fr
        LEFT JOIN students s ON s.id = fr.student_id AND s.school_id = fr.school_id
        LEFT JOIN LATERAL (
          SELECT fs.name AS fee_name
          FROM fee_structures fs
          WHERE fs.school_id = fr.school_id
            AND lower(trim(fs.fee_type)) = lower(trim(fr.fee_type))
          ORDER BY fs.id ASC
          LIMIT 1
        ) structure ON true
        LEFT JOIN (
          SELECT
            fee_record_id,
            SUM(amount)::int AS total_paid
          FROM payment_records
          WHERE school_id = ${schoolId} AND fee_record_id IS NOT NULL
          GROUP BY fee_record_id
        ) p ON p.fee_record_id = fr.id
        LEFT JOIN LATERAL (
          SELECT pr.payment_method AS raw_payment_method,
                 pr.reference_number AS raw_reference_number
          FROM payment_records pr
          WHERE pr.school_id = fr.school_id
            AND pr.fee_record_id = fr.id
            AND (pr.cashier_notes IS NULL OR pr.cashier_notes <> 'Auto-recorded from Add Fee Record')
          ORDER BY pr.created_at DESC, pr.id DESC
          LIMIT 1
        ) lp ON true
        WHERE fr.school_id = ${schoolId}
          ${ledgerPostSessionCond}
          ${ledgerPostExtraWhere}
          ${!selectAllMatching && selectedIdsArray ? sql`AND fr.id = ANY(${selectedIdsArray})` : sql``}
          ${selectAllMatching  && excludedIdsArray ? sql`AND fr.id != ALL(${excludedIdsArray})` : sql``}
        ORDER BY s.class, s.name, fr.due_date
      `);

      const schoolRow = (await db.execute(sql`
        SELECT name, logo_url, address_line1, address_line2, city, state, pin_code, phone, email
        FROM schools WHERE id = ${schoolId} LIMIT 1
      `)).rows[0] as any;

      let sessionLabel: string | null = null;
      if (sessionFilter) {
        const sess = (await db.execute(sql`
          SELECT session_name FROM academic_sessions WHERE id = ${sessionFilter} LIMIT 1
        `)).rows[0] as any;
        sessionLabel = sess?.session_name ?? null;
      }

      const logoRelUrl = schoolRow?.logo_url ?? null;
      const logoUrl = logoRelUrl
        ? (/^https?:\/\//i.test(logoRelUrl) ? logoRelUrl : `${req.protocol}://${req.get("host")}${logoRelUrl}`)
        : null;

      // Backward-compatible renderer metadata: summarize first selected value or joined labels.
      const pdfBuffer = await renderLedgerPdf({
        school: {
          name: schoolRow?.name ?? "School", logoUrl,
          addressLine1: schoolRow?.address_line1 ?? null,
          addressLine2: schoolRow?.address_line2 ?? null,
          city: schoolRow?.city ?? null, state: schoolRow?.state ?? null,
          pinCode: schoolRow?.pin_code ?? null,
          phone: schoolRow?.phone ?? null, email: schoolRow?.email ?? null,
        },
        sessionLabel,
        filters: {
          search:   ledgerPostFilters.search   || undefined,
          status:   firstLedgerFilterValue(ledgerPostFilters.statuses),
          class:    firstLedgerFilterValue(ledgerPostFilters.classes),
          feeName:  joinedLedgerFilterLabel(ledgerPostFilters.feeNames),
          feeType:  firstLedgerFilterValue(ledgerPostFilters.feeTypes),
          dateFrom: ledgerPostFilters.dueDateFrom  || undefined,
          dateTo:   ledgerPostFilters.dueDateTo    || undefined,
        },
        rows: (rows.rows as any[]) as LedgerRow[],
        generatedAtIST: formatInstantIST(new Date()),
      });

      const sessionTag = sessionLabel ? sessionLabel.replace(/[^a-zA-Z0-9-]/g, "-") : todayInIST();
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="Fee-Ledger-${sessionTag}.pdf"`);
      res.send(pdfBuffer);
    } catch (err) {
      console.error("[ledger-pdf-post]", err);
      res.status(500).json({ message: String(err) });
    }
  });

  // ── School-wide Transaction History — PDF download ────────────────────────
  // GET  — no-selection export: filters from query string.
  // POST — selection-aware export: filters + selection from request body.
  //
  // Both routes share buildTransactionRows() from transaction-report-data.ts.
  // The invoice population is resolved server-side by fr.session_id; we never
  // constrain payment_attempts.session_id or payment_records.session_id.
  // ──────────────────────────────────────────────────────────────────────────

  /** Shared PDF render + response helper for both GET and POST handlers. */
  async function sendTransactionPdf(
    req: any,
    res: any,
    schoolId: number,
    sessionFilter: number | null,
    txFilters: ReturnType<typeof normalizeLedgerFiltersFromQuery>,
    selection?: TxSelectionParams,
    selectionLabel?: string,
  ): Promise<void> {
    const txRows = await buildTransactionRows(schoolId, sessionFilter, txFilters, selection);

    const schoolRow = (await db.execute(sql`
      SELECT name, logo_url, address_line1, address_line2, city, state, pin_code, phone, email
      FROM schools WHERE id = ${schoolId} LIMIT 1
    `)).rows[0] as any;

    let sessionLabel: string | null = null;
    if (sessionFilter) {
      const sess = (await db.execute(sql`
        SELECT session_name FROM academic_sessions
        WHERE id = ${sessionFilter} AND school_id = ${schoolId} LIMIT 1
      `)).rows[0] as any;
      sessionLabel = sess?.session_name ?? null;
    }

    // School logos are uploaded beneath the local uploads/ directory. Read the
    // file directly instead of constructing an HTTP URL from the request Host
    // header, which would turn PDF rendering into a server-side request target.
    const logoRelUrl = typeof schoolRow?.logo_url === "string"
      ? schoolRow.logo_url
      : null;
    let logoData: Buffer | null = null;
    if (logoRelUrl?.startsWith("/uploads/")) {
      const uploadsRoot = path.resolve(process.cwd(), "uploads");
      const logoPath = path.resolve(process.cwd(), `.${logoRelUrl}`);
      if (logoPath.startsWith(`${uploadsRoot}${path.sep}`)) {
        try {
          logoData = await fs.promises.readFile(logoPath);
        } catch {
          logoData = null;
        }
      }
    }

    const pdfBuffer = await renderTransactionPdf({
      school: {
        name: schoolRow?.name ?? "School",
        logoUrl: null,
        logoData,
        addressLine1: schoolRow?.address_line1 ?? null,
        addressLine2: schoolRow?.address_line2 ?? null,
        city: schoolRow?.city ?? null, state: schoolRow?.state ?? null,
        pinCode: schoolRow?.pin_code ?? null,
        phone: schoolRow?.phone ?? null, email: schoolRow?.email ?? null,
      },
      sessionLabel,
      filters: txFilters,
      selectionLabel: selectionLabel ?? null,
      rows: txRows,
      generatedAtIST: formatInstantIST(new Date()),
    });

    const sessionTag = sessionLabel ? sessionLabel.replace(/[^a-zA-Z0-9-]/g, "-") : todayInIST();
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Payment-Transaction-Report-${sessionTag}.pdf"`);
    res.send(pdfBuffer);
  }

  app.get("/api/admin/fees/payments/report/pdf", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const sessionFilter = await resolveFeeViewSession(req, res, schoolId);
    if (sessionFilter === undefined) return;
    if (sessionFilter === null) return res.status(409).json({ message: "No academic session selected or active." });

    // Normalize all ledger filters from query (same contract as ledger endpoints).
    const txFilters = normalizeLedgerFiltersFromQuery(req.query as Record<string, unknown>);

    try {
      await sendTransactionPdf(req, res, schoolId, sessionFilter, txFilters);
    } catch (err) {
      console.error("[transaction-pdf]", err);
      res.status(500).json({ message: String(err) });
    }
  });

  // ── School-wide Transaction History — PDF download (POST — selection-aware) ─
  // Accepts the same filters as the GET endpoint plus:
  //   selectAllMatching: boolean  — true = all matching records (minus excludedIds)
  //   selectedIds: number[]       — explicit fee_record IDs (when selectAllMatching = false)
  //   excludedIds: number[]       — IDs to carve out when selectAllMatching = true
  //
  // Security: school_id + session are always enforced server-side. All invoice
  // filters also remain active. The selection is applied to fee_record IDs
  // inside the invoice population — the browser cannot export rows outside the
  // authenticated school/session scope.
  app.post("/api/admin/fees/payments/report/pdf", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const sessionFilter = await resolveFeeViewSession(req, res, schoolId);
    if (sessionFilter === undefined) return;
    if (sessionFilter === null) return res.status(409).json({ message: "No academic session selected or active." });

    // Extract selection predicates from body
    const body = req.body as Record<string, unknown>;
    const rawSelectAll   = body.selectAllMatching;
    const rawSelectedIds = body.selectedIds;
    const rawExcludedIds = body.excludedIds;

    // ── Strict validation ─────────────────────────────────────────────────────
    // selectAllMatching, when present, must be a boolean.
    if (rawSelectAll !== undefined && typeof rawSelectAll !== "boolean") {
      return res.status(400).json({ message: "selectAllMatching must be a boolean." });
    }
    const selectAllMatching = rawSelectAll === true;

    // selectedIds / excludedIds, when present, must be arrays of positive integers.
    // Any non-array, or an array with a non-positive/non-integer entry, is a 400 —
    // never silently coerced (a malformed explicit selection must not export all).
    const validateIdArray = (v: unknown, field: string): number[] | { error: string } => {
      if (v === undefined || v === null) return [];
      if (!Array.isArray(v)) return { error: `${field} must be an array of positive integers.` };
      for (const x of v) {
        if (!Number.isInteger(x) || (x as number) <= 0) {
          return { error: `${field} must contain only positive integers.` };
        }
      }
      // Deduplicate while preserving order.
      return Array.from(new Set(v as number[]));
    };

    const selectedIdsResult = validateIdArray(rawSelectedIds, "selectedIds");
    if (!Array.isArray(selectedIdsResult)) {
      return res.status(400).json({ message: selectedIdsResult.error });
    }
    const excludedIdsResult = validateIdArray(rawExcludedIds, "excludedIds");
    if (!Array.isArray(excludedIdsResult)) {
      return res.status(400).json({ message: excludedIdsResult.error });
    }
    const selectedIds = selectedIdsResult;
    const excludedIds = excludedIdsResult;

    // Explicit mode (selectAllMatching=false) with no selected IDs is an error —
    // returning an empty 200 PDF would be misleading.
    if (!selectAllMatching && selectedIds.length === 0) {
      return res.status(400).json({
        message: "Explicit selection requires at least one selected invoice ID.",
      });
    }

    const selection: TxSelectionParams = { selectAllMatching, selectedIds, excludedIds };

    // Build a human-readable selection label for the PDF header
    let selectionLabel: string | undefined;
    if (!selectAllMatching && selectedIds.length > 0) {
      selectionLabel = `${selectedIds.length} selected invoice${selectedIds.length !== 1 ? "s" : ""}`;
    } else if (selectAllMatching && excludedIds.length > 0) {
      selectionLabel = `All matching (${excludedIds.length} excluded)`;
    }

    // Normalize all ledger filters from body (POST body, same old-singular-field compat).
    const txFilters = normalizeLedgerFiltersFromBody(body);

    try {
      await sendTransactionPdf(req, res, schoolId, sessionFilter, txFilters, selection, selectionLabel);
    } catch (err) {
      console.error("[transaction-pdf-post]", err);
      res.status(500).json({ message: String(err) });
    }
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

    const actor = await resolveFeeAuditActor(req, schoolId);
    await db.transaction(async tx => {
      await storage.upsertNotificationConfig(schoolId, update, tx);
      await appendFeeAudit({
        schoolId,
        actor,
        action: "update_notification_config",
        entityType: "notification_config",
        entityId: null,
        recordLabel: "Payment reminder settings",
        description: `Updated payment reminder channels: SMS ${d.smsEnabled ? "enabled" : "disabled"}, WhatsApp ${d.waEnabled ? "enabled" : "disabled"}, email ${d.emailEnabled ? "enabled" : "disabled"}.`,
        ipAddress: requestIpAddress(req),
      }, tx);
    });
    res.json({ ok: true });
  });

  // ── Admin: Dunning Counts (aggregated per-fee-record, for ledger badges) ──
  // Returns { feeRecordId: sentCount } map scoped to the active/viewed session.
  // Only counts entries with status = 'sent' so failed attempts are not presented
  // as delivered reminders to the admin.
  app.get("/api/admin/fees/dunning-counts", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    const sessionFilter = await resolveFeeViewSession(req, res, schoolId);
    if (sessionFilter === undefined) return;
    if (sessionFilter === null) return res.json({});

    const result = await db.execute(
      sql`
            SELECT dl.fee_record_id AS "feeRecordId", COUNT(dl.id)::int AS count
            FROM dunning_log dl
            INNER JOIN fee_records fr ON fr.id = dl.fee_record_id AND fr.school_id = dl.school_id
            WHERE dl.school_id = ${schoolId}
              AND dl.status = 'sent'
              AND fr.session_id = ${sessionFilter}
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
    const sessionFilter = await resolveFeeViewSession(req, res, schoolId);
    if (sessionFilter === undefined) return;
    if (sessionFilter === null) return res.json({});

    const result = await db.execute(
      sql`
            SELECT
              al.entity_id::int            AS "feeRecordId",
              COUNT(al.id)::int            AS count,
              (ARRAY_AGG(al.description ORDER BY al.created_at DESC))[1] AS "lastError"
            FROM fee_audit_log al
            INNER JOIN fee_records fr ON fr.id = al.entity_id::int AND fr.school_id = al.school_id
            WHERE al.school_id   = ${schoolId}
              AND al.action      = 'payment_failed'
              AND al.entity_type = 'fee_record'
              AND al.entity_id   IS NOT NULL
              AND fr.session_id  = ${sessionFilter}
              AND fr.status      <> 'Paid'
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
    const sessionFilter = await resolveFeeViewSession(req, res, schoolId);
    if (sessionFilter === undefined) return;
    if (sessionFilter === null) return res.json([]);
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
            LEFT JOIN fee_records fr ON fr.id = dl.fee_record_id AND fr.school_id = dl.school_id
            WHERE dl.school_id = ${schoolId}
              AND dl.fee_record_id IN (
                SELECT id FROM fee_records
                WHERE student_id = ${studentId}
                  AND school_id = ${schoolId}
                  AND session_id = ${sessionFilter}
              )
            ORDER BY dl.sent_at DESC
            LIMIT 200`
        : sql`
            SELECT dl.id, dl.fee_record_id, dl.channel, dl.stage, dl.sent_at, dl.status,
                   dl.error_message, dl.recipient, dl.student_name,
                   (fr.id IS NULL) AS fee_record_deleted
            FROM dunning_log dl
            LEFT JOIN fee_records fr ON fr.id = dl.fee_record_id AND fr.school_id = dl.school_id
            WHERE dl.school_id = ${schoolId}
              AND fr.session_id = ${sessionFilter}
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
    stage:       z.enum(["D-2", "D+0", "D+3", "D+7", "D+14"]),
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
    const actor = await resolveFeeAuditActor(req, schoolId);
    await db.transaction(async tx => {
      for (const t of templates) {
        await tx
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
      await appendFeeAudit({
        schoolId,
        actor,
        action: "settings_change",
        entityType: "dunning_templates",
        entityId: null,
        recordLabel: "Payment reminder templates",
        description: `Updated ${templates.length} payment reminder template${templates.length === 1 ? "" : "s"}.`,
        ipAddress: requestIpAddress(req),
      }, tx);
    });
    res.json({ ok: true });
  });

  // ── Admin: Dunning Job Status ─────────────────────────────────────────────
  app.get("/api/admin/fees/dunning-job-status", async (req, res) => {
    if (!adminGuard(req, res)) return;
    const schoolId = req.session.schoolId!;
    try {
      const rows = await db.select().from(dunningJobStatus)
        .where(eq(dunningJobStatus.schoolId, schoolId))
        .limit(1);
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
      const sessionFilter = await resolveFeeViewSession(req, res, schoolId);
      if (sessionFilter === undefined) return;
      if (sessionFilter === null) return res.status(409).json({ message: "No academic session selected or active." });
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
            dueDate: todayInIST(),
            stage: "D+0",
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

    const bucket = req.query.bucket;
    const allowed = ["1-30", "31-60", "61-90", "90+"];
    if (typeof bucket !== "string" || !allowed.includes(bucket)) {
      return res.status(400).json({ message: "bucket must be one of: 1-30, 31-60, 61-90, 90+" });
    }

    // ── Scalar date-range validation (matches canonical custom-range rules) ──
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    if (typeof startDate !== "string" || typeof endDate !== "string") {
      return res.status(400).json({ message: "startDate and endDate must be single YYYY-MM-DD values." });
    }
    if (!isValidDate(startDate) || !isValidDate(endDate)) {
      return res.status(400).json({ message: "startDate and endDate must be valid YYYY-MM-DD calendar dates." });
    }
    if (startDate > endDate) {
      return res.status(400).json({ message: "startDate must be on or before endDate." });
    }
    // Max five years (inclusive day count), mirroring the canonical service.
    if (daysBetween(startDate, endDate) + 1 > 5 * 366) {
      return res.status(400).json({ message: "Date range may not exceed 5 years." });
    }

    // ── Require a selected/active session; validate tenant ownership ─────────
    const viewSessionId: number | null = (req as any).viewSessionId ?? null;
    const sessionId = viewSessionId ?? (await storage.getActiveSession(schoolId))?.id ?? null;
    if (!sessionId) {
      return res.status(409).json({ message: "No academic session selected or active." });
    }

    const today = todayIST(); // IST calendar date, matches canonical overdue basis

    // Bucket → days-overdue window, relative to `today` (IST), not DB CURRENT_DATE.
    let bucketCondition: ReturnType<typeof sql>;
    if (bucket === "1-30")       bucketCondition = sql`(${today}::date - fr.due_date::date) BETWEEN 1 AND 30`;
    else if (bucket === "31-60") bucketCondition = sql`(${today}::date - fr.due_date::date) BETWEEN 31 AND 60`;
    else if (bucket === "61-90") bucketCondition = sql`(${today}::date - fr.due_date::date) BETWEEN 61 AND 90`;
    else                         bucketCondition = sql`(${today}::date - fr.due_date::date) > 90`;

    try {
      // Validate session ownership; every query is constrained through
      // session_id + school_id below regardless.
      const sesRow = await db.execute(sql`
        SELECT id FROM academic_sessions
        WHERE id = ${sessionId} AND school_id = ${schoolId} LIMIT 1
      `);
      if (sesRow.rows.length === 0) {
        return res.status(404).json({ message: "Selected session not found for this school." });
      }

      // Canonical aging population:
      //  - fee_records whose due_date is within [startDate, endDate], selected
      //    session, selected school
      //  - lifetime successful payments (school-scoped subquery)
      //  - lifetime processed refunds added back into the unpaid balance
      //  - overdue relative to `today` (IST); no reliance on fr.status
      //  - outstanding = GREATEST(billed - lifetime_paid + lifetime_refunds, 0)
      const result = await db.execute(sql`
        SELECT
          fr.id                                                                       AS fee_record_id,
          fr.student_id,
          s.name                                                                      AS student_name,
          s.class,
          s.section,
          fr.fee_type,
          fr.due_date,
          GREATEST(
            fr.amount + fr.late_fee_amount - COALESCE(p.paid, 0) + COALESCE(rf.refunded, 0),
            0
          )::int                                                                      AS amount,
          (${today}::date - fr.due_date::date)::int                                   AS days_overdue
        FROM fee_records fr
        JOIN students s ON s.id = fr.student_id AND s.school_id = ${schoolId}
        LEFT JOIN (
          SELECT fee_record_id, SUM(amount)::int AS paid
          FROM payment_records
          WHERE school_id = ${schoolId} AND fee_record_id IS NOT NULL
          GROUP BY fee_record_id
        ) p ON p.fee_record_id = fr.id
        LEFT JOIN (
          SELECT fee_record_id,
                 (SUM(COALESCE(processed_amount_paise, requested_amount_paise)) / 100.0) AS refunded
          FROM refunds
          WHERE school_id = ${schoolId}
            AND local_status = 'processed'
            AND fee_record_id IS NOT NULL
          GROUP BY fee_record_id
        ) rf ON rf.fee_record_id = fr.id
        WHERE fr.school_id = ${schoolId}
          AND fr.session_id = ${sessionId}
          AND fr.due_date IS NOT NULL
          AND fr.due_date >= ${startDate}
          AND fr.due_date <= ${endDate}
          AND fr.due_date::date < ${today}::date
          AND ${bucketCondition}
          AND GREATEST(
                fr.amount + fr.late_fee_amount - COALESCE(p.paid, 0) + COALESCE(rf.refunded, 0),
                0
              ) > 0
        ORDER BY amount DESC
        LIMIT 200
      `);
      res.json(result.rows);
    } catch (err: any) {
      console.error("[fees/aging-students]", err);
      res.status(500).json({ message: "Failed to load aging defaulters." });
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
      const sessionFilter = await resolveFeeViewSession(req, res, schoolId);
      if (sessionFilter === undefined) return;
      if (sessionFilter === null) return res.status(409).json({ message: "No academic session selected or active." });
      const feeContext = (await db.execute(sql`
        SELECT fr.invoice_number, fr.session_id, fr.student_id, s.name AS student_name
        FROM fee_records fr
        LEFT JOIN students s ON s.id = fr.student_id AND s.school_id = fr.school_id
        WHERE fr.id = ${Number(feeRecordId)}
          AND fr.school_id = ${schoolId}
          AND fr.session_id = ${sessionFilter}
        LIMIT 1
      `)).rows[0] as any;
      if (!feeContext) {
        return res.status(404).json({ message: "Fee record not found in the selected academic session." });
      }
      const { runDunningForSingleFee } = await import("./dunning");
      const result = await runDunningForSingleFee(schoolId, Number(feeRecordId), sessionFilter);
      await appendFeeAudit({
        schoolId,
        actor: await resolveFeeAuditActor(req, schoolId),
        action: "reminder_sent",
        entityType: "fee_record",
        entityId: Number(feeRecordId),
        studentId: feeContext?.student_id == null ? null : Number(feeContext.student_id),
        studentName: feeContext?.student_name ?? null,
        sessionId: feeContext?.session_id ?? null,
        recordLabel: feeContext?.invoice_number ?? null,
        description: `Payment reminder run completed for ${feeContext?.invoice_number ?? "the selected invoice"}: ${result.sent.length} sent, ${result.failed.length + result.skipped.length} not sent.`,
        ipAddress: requestIpAddress(req),
      });
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
    if (!await requireStudentFeeSession(req, res, student.schoolId)) return;

    const viewSessionId: number | null = (req as any).viewSessionId ?? null;
    const sessionCond = viewSessionId != null
      ? sql`AND COALESCE(fr.session_id, pa.session_id) = ${viewSessionId}`
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
          COALESCE(fr.fee_name, fr.fee_type)                                AS "feeName",
          fr.invoice_number                                                AS "invoiceNumber",

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
          COALESCE(pa.attempt_number, (ROW_NUMBER() OVER (
            PARTITION BY COALESCE(pa.fee_record_id, pa.id)
            ORDER BY pa.created_at ASC
          ))::integer)                                                       AS "attemptNumber"

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
    if (!await requireStudentFeeSession(req, res, student.schoolId)) return;
    const viewSessionId: number | null = (req as any).viewSessionId ?? null;
    const rows = await storage.getDunningLogByStudent(student.id, student.schoolId, viewSessionId);
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
    if (!await requireStudentFeeSession(req, res, student.schoolId)) return;
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
