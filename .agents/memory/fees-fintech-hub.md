---
name: Fees & Payments Fintech Hub
description: DB tables, route registration, idempotency flow, high-value re-auth, and 5-tab UI for the fees module
---

# Fees & Payments Fintech Hub

4 DB tables: `fee_records`, `fee_audit_log`, `payment_attempts`, `dunning_log`

Routes registered in `server/routes.ts` via the standard flat registration pattern (no sub-router).

Idempotency key flow: `fee_records.razorpay_order_id` guards against duplicate order creation.

High-value payment re-auth: amounts ≥ ₹10 000 require a second PIN confirmation before Razorpay order creation.

5-tab UI in `fees-manager.tsx`:  Overview · Fee Records · Payments · Dunning · Settings.

**School address in receipts:** `schools` table now has structured address fields (`address_line1`, `address_line2`, `city`, `state`, `pin_code`, `country`, `phone`, `email`) — these should flow into fee receipts/invoices rather than hardcoding a blank address. See `GET /api/admin/profile` for the data shape.

## Two-Identifier Architecture (Steps 1–3)

`fee_records` now carries TWO separate number fields:

| Field | Column | Format | Assigned when | Mutable? |
|---|---|---|---|---|
| `invoiceNumber` | `invoice_number VARCHAR(50)` | `INV-0001` | At creation (all 3 flows) | NEVER |
| `receiptNumber` | `receipt_number VARCHAR(50)` | `ON-0001` / `OF-0001` | After successful payment | Overwritten by payment |

**Invoice number rules:**
- Sequence key `"INV-"`, 4-digit zero-padded, scoped per `school_id` in `receipt_sequences` table.
- Assigned by `storage.nextReceiptNumber(schoolId, "INV-", 4)` — call it BEFORE `createFeeRecord()`.
- Partial unique index `fee_records_school_invoice_uniq ON fee_records (school_id, invoice_number) WHERE invoice_number IS NOT NULL` enforces per-school uniqueness; multiple NULLs allowed.
- Payment flows must NEVER write to `invoice_number`.

**Three creation flows that set `invoiceNumber`:**
1. Add Invoice — `server/routes.ts` POST `/api/admin/fees`
2. Generate Invoices (bulk) — `server/fees-routes.ts` POST `/api/admin/fees/structures/:id/generate-invoices`
3. Auto-Invoice (trigger + monthly cron) — `server/fees-routes.ts` POST `/…/auto-invoice/trigger` and `server/index.ts` monthly job

**Duplicate prevention (existing as of Step 3):**
- Bulk/auto flows check `existingMap` before calling `createFeeRecord` — existing Due/Overdue records are synced (amount/dueDate) without consuming a new INV number; Paid/Partial/Waived are skipped entirely.
- Existing records with `invoice_number = NULL` (pre-Step 3) are left untouched.

**Existing data (12 pre-Step 3 records):** all have `invoice_number = NULL`. 9 Paid with ON receipts, 3 Overdue with no numbers. Not backfilled.

## Late Fee Production Fixes (Step 21)

**Single source of truth:** `acquireRazorpayOrder` now calls `calculateLateFee()` on-the-fly at order creation instead of reading stale `fee_records.late_fee_amount`. Order `notes.lateFeeAmount` carries the immutable snapshot for the webhook.

**Webhook reconciliation:** `payment.captured` reads `notes.lateFeeAmount`, stores `amount = base + lateFeeFromNotes` and `lateFeePaid = lateFeeFromNotes` in `payment_records`.

**Offline single-invoice:** Guard 2 validates `paymentOnly.amount === base + currentLateFee` (not just base). Pre-loads fee structures before the transaction; `lateFeeForOfflineInsert` captured via closure for the INSERT.

**FIFO balance:** SQL now uses `fr.amount + fr.late_fee_amount - paid` for balance and HAVING. The `late_fee_paid` in each FIFO payment INSERT is set to `step.lateFeeAmount`.

**AcquireOrderResult** success shape now includes `lateFeeAmount: number`. Existing tests unaffected (no fee structure → `DEFAULT_LATE_FEE_CONFIG` → late fee = 0).

**Test coverage:** `server/__tests__/late-fee-engine.test.ts` (27 pure unit tests, all pass in isolation); `server/__tests__/late-fee-integration.test.ts` (8 tests, 1 unit guard passes in isolation, 7 DB tests pass in full `npm test` suite — same as all other DB integration tests).
