---
name: Fees & Payments Fintech Hub
description: Architecture, constraints, and patterns for the refactored Fees & Payments module (4 new DB tables, fees-routes.ts, 5-tab UI) plus follow-up features.
---

## Tables Added
- `fee_structures` — fee templates (name, type, amount, frequency, applicable_classes, concession, due_day, last_invoices_generated_at)
- `payment_records` — offline payment entries with idempotency_key UNIQUE constraint
- `fee_audit_log` — append-only audit trail (no update/delete endpoints)
- `external_payment_settings` — per-school UPSERT row (schoolId is UNIQUE)
- `payment_attempts` — **NEW** unified ledger for every Razorpay interaction (captured, failed, cancelled, authorized, refunded). See "Payment Attempts Table" below.

## Backend Pattern
- All new routes live in `server/fees-routes.ts` → `registerFeesRoutes(app)`, called from `server/routes.ts` before `registerTeacherRoutes`.
- Registered BEFORE existing `/api/admin/fees` routes to avoid `:id` shadowing.
- Main ledger GET (`GET /api/admin/fees`) lives in `server/routes.ts` at line ~3976, NOT in fees-routes.ts.
- Audit logging via `storage.appendFeeAuditLog(...)` in a try/catch (non-critical).

## Idempotency (payment_records)
- Client generates a random `idempotencyKey` once per modal open (stored in state), not on each submit click.
- Server checks `getPaymentRecordByIdempotencyKey(key, schoolId)` — scoped by schoolId to prevent cross-tenant collisions.
- If found, returns existing record with `idempotent: true` (HTTP 200).
- Prevents duplicate submissions on retry.

## High-Value Payment Re-Auth
- Payments ≥ ₹10,000 require `adminPassword` field in the POST body.
- Server does `bcrypt.compare(adminPassword, users.passwordHash)`.
- If `adminPassword` missing → HTTP 402 `{ requiresConfirm: true }`.
- Frontend catches the 402, stores pending payload, shows password dialog (step="confirm"), re-submits with `adminPassword`.
- After successful recording: RecordPaymentModal transitions to step="done" (not auto-close) showing Print Receipt button.

## Tenant Security (payment write path)
- `POST /api/admin/fees/payments` validates studentId belongs to `req.session.schoolId` before insert.
- Also validates feeRecordId (if provided) belongs to same school AND same student.
- Idempotency key lookup is school-scoped.

## Payment Settlement Logic
- When a linked feeRecordId is provided, backend sums ALL payment_records for that feeRecordId.
- Sets status to `Paid` if cumulative >= invoice amount, `Partial` otherwise.
- On settlement: also applies `feeNotes` patch to the fee record if `_fn` is non-null (so Pay-button Notes edits persist).
- Supports installment scenarios correctly across multiple payment submissions.

## Pay-Button Modal (feeRecord pre-linked path)
- When Pay is clicked on a ledger row, modal shows Status (read-only "Paid"), Academic Year (read-only from fee record), and Notes (editable).
- `buildPayload` passes `feeNotes` unconditionally (not nulled when feeRecord exists).
- Server: inside the transaction UPDATE, appends `, notes = $fn` only when `_fn != null`.
- Academic year and feeNotes are pre-seeded from feeRecord on modal open via useEffect.

## Archive Write Guard
- Payment modal uses `sessionFetch` (not raw `fetch`) so `x-view-session-id` header is always injected.
- Server-side `checkSessionContext` middleware rejects mutations against archived sessions with 403.

## Fee Structure → Ledger Sync (PATCH route)
- `PATCH /api/admin/fees/structures/:id` reads `before` state, then bulk-updates ALL Due/Overdue fee records when `amount` or `feeType` changes.
- Matches by OLD feeType, so a rename + amount change both work correctly in one pass.
- Response includes `syncedInvoices: N`; toast shows "✅ N unpaid invoices synced to ₹X".
- **Does NOT sync Paid/Waived/Partial records** — intentional, settled invoices are locked.
- saveMut.onSuccess invalidates all 5 keys: structures, fees, summary, payments, audit-log.

## Invoice Generation (generate-invoices + auto-trigger)
- Both routes now stamp `academicYear: session.sessionName` on every created fee record.
- Both routes set `notes: null` on created records (no "Auto-generated…" noise in notes column).
- `storage.getAcademicSessionById(sessionId)` used in generate-invoices route to get sessionName.
- genMut.onSuccess invalidates all 5 cache keys.

## Auto-Generated Notes Cleanup (historical data)
- Ran `UPDATE fee_records SET notes = NULL WHERE notes ILIKE 'Auto-generated%'` — cleared 8 records.
- Ran `UPDATE fee_records SET academic_year = s.session_name FROM academic_sessions s WHERE fr.session_id = s.id AND (fr.academic_year IS NULL OR fr.academic_year = '')` — backfilled 8 records.

## Export Ledger CSV
- Route: `GET /api/admin/fees/export-ledger` in `server/fees-routes.ts`.
- LEFT JOINs `fee_structures fs ON fs.fee_type = fr.fee_type AND fs.school_id = fr.school_id` to get `fs.name AS fee_name`.
- Column order matches ledger display exactly: Receipt No. | Student Name | Student ID | Class | Section | Fee Name | Fee Type | Amount (₹) | Due Date | Status | Paid On | Acad. Year | Notes | [then extras: Amount Paid, Outstanding, Payment Method, Reference No.]
- Filters: dateFrom, dateTo, class, feeType, feeName (all optional query params).
- ExportLedgerDialog: availableFeeNames prop passes allFeeNames from parent; feeName filter state wired to feeName param.

## Fee Name in Ledger (client-side)
- Ledger table renders fee name via `feeTypeToName.get(rec.feeType) ?? "—"` — a Map built from fee structures.
- Name changes on structures show immediately after structures cache invalidates (no server JOIN needed for ledger table).
- Export route uses server-side JOIN (always live).

## Known Data Gap
- Records 52–54 (Annual fees, Due) were created at ₹10,000; structure is now ₹20,000. Sync code wasn't deployed when structure was edited. Task #108 covers the fix.
- Record 55 (Annual fees, Paid) correctly left at ₹10,000 — paid invoices must not be retroactively changed.

## Session-Scoping (Ledger & MetricBar only)
- `FeesManager` reads `selectedSession` from `useSessionView()`, derives `viewSessionId`.
- Both include it in their React Query `queryKey` → per-session cache entries.
- `invalidateQueries({ queryKey: ["/api/admin/fees"] })` uses prefix matching and invalidates all session variants.
- **Fee Structures, External Portal, and Audit Log are intentionally school-wide.**

## Receipt Sequence System
- `receipt_sequences` table: `{ prefix VARCHAR(10) UNIQUE, current_number INTEGER DEFAULT 0 }`.
- **Prefix convention**: AF = Add Fee (admin), OP = Offline Payment, ON = Online (Razorpay).
- Deleting fee/payment records never touches sequences — numbers are permanent.

## Razorpay Integration
- Credentials stored in `external_payment_settings`: razorpay_key_id, razorpay_key_secret, razorpay_webhook_secret, razorpay_mode, razorpay_enabled.
- Secrets masked (`••••••••`) on GET — never echoed in plaintext.
- `POST /api/webhooks/razorpay` — HMAC verified against `req.rawBody`. Handles `payment.captured`, `payment.failed`, `payment.authorized`, `refund.*`.
- Student portal-info returns `razorpayEnabled` and `razorpayKeyId` (never secret).
- Credential resolver: `resolveRazorpayCredentials(schoolId)` returns `{ keyId, keySecret, webhookSecret, enabled } | null`.

## Payment Attempts Table (payment_attempts)
**Single source of truth for the student History tab.** Created in `server/index.ts` startup migration.

### Schema highlights
- `outcome`: `pending | authorized | captured | failed | cancelled | refunded`
- Unique index on `(school_id, razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL` — prevents duplicate webhook delivery.
- Partial unique index on `(school_id, razorpay_order_id) WHERE razorpay_payment_id IS NULL` — one cancelled row per order.
- `payment_records` and `fee_audit_log` writes are KEPT for backward compat (receipts, audit trail).

### Enrichment module: `server/rzp-enrichment.ts`
- `upsertPaymentAttempt(data)` — idempotent UPSERT. Captured/refunded outcomes are terminal and never downgraded.
- `fetchRazorpayData(paymentId, orderId, creds)` — fire-and-forget `payments.fetch + orders.fetch`; fills fee/tax/acquirer fields.
- `mapRazorpayPayment(entity)` — maps full Razorpay API entity to our column schema (card network, last4, RRN, auth code, fee, tax…).
- `updatePaymentAttemptRefund(...)` — updates refund columns from `refund.*` webhook.

### Write points in fees-routes.ts
1. `payment.captured` webhook → `upsertPaymentAttempt` (immediate) + background `fetchRazorpayData` for fee/tax.
2. `payment.failed` webhook → `upsertPaymentAttempt` (webhook payload already has card + error fields).
3. `payment.authorized` webhook → `upsertPaymentAttempt`.
4. `refund.*` webhook → `updatePaymentAttemptRefund`.
5. `clear-failed-order` → `upsertPaymentAttempt` + conditional background `fetchRazorpayData` (when payment ID present, i.e. client-reported failure, not voluntary dismiss).
- All writes are `void …catch(warn)` — non-fatal; existing `payment_records` write is the source of truth for receipts.

### Startup backfill
- Migrated from `payment_records` → `payment_attempts` (captured rows).
- Migrated from `fee_audit_log` WHERE action IN ('payment_failed','payment_cancelled') → `payment_attempts`.

### `/api/student/fees/payment-attempts` endpoint
- Single SQL query from `payment_attempts` LEFT JOIN `fee_records` + `payment_records`.
- Returns all new fields: `amountPaise`, `razorpayFeePaise`, `razorpayTaxPaise`, `cardNetwork`, `cardType`, `cardIssuer`, `bankRrn`, `bankAuthCode`, `vpa`, `wallet`, `payerEmail`, `payerContact`, `rzpCreatedAt/AuthorizedAt/CapturedAt/FailedAt`, `refundId/Status/AmountPaise/InitiatedAt/ProcessedAt`, `apiSyncedAt`.
- `viewSessionId` session filter applied via `COALESCE(pa.session_id, fr.session_id)`.

### Client: PaymentAttempt interface + Technical Details
- `PaymentAttempt` interface in `student-fees.tsx` expanded with 20+ new fields.
- Helper components at module scope: `SectionGroup`, `TechRow`, `maskEmail`, `maskPhone`.
- **Failed attempts**: Technical Details accordion redesigned into 8 collapsible sections — Payment Identification, Amount & Financial, Payment Method, Bank & Acquirer, Failure Details, Timeline, Customer, Refund.
- **Paid attempts**: New subtle gray Technical Details accordion added (same 8 sections minus Failure Details) — only shown when API-enriched data is present.

**Why:** Every payment attempt (captured, failed, cancelled) now has a permanent audit row. Razorpay fee/tax/acquirer data (card network, bank RRN, auth code) fills in from API without blocking the webhook response. Students and admins see the same structured data the Razorpay dashboard shows.

## Storage Summary Function
- `getFeeSummary(schoolId, sessionId?)` aggregates `fee_records` (status=Paid → revenue, else → outstanding).
- `offlinePaymentsCount` from COUNT(*) on `payment_records`.

## Structured Payment Failure Data Model (fee_audit_log)
New columns added to `fee_audit_log` via startup migration:
`session_id`, `razorpay_payment_id`, `razorpay_order_id`, `amount`, `currency`, `error_code`, `error_source`, `error_step`, `error_reason`, `payment_method`, `raw_response` (JSONB).

Two distinct action values for failed attempts:
- `payment_failed` — real gateway failure (card declined, bank error, etc.)
- `payment_cancelled` — student voluntarily closed checkout modal (no payment attempted)

`classifyAttempt()` in student-fees.tsx uses structured `isCancelled` flag first, then `errorReason` for expiry detection — no string-parsing heuristics.

Gateway-source failures show an extra warning: "If your bank account was debited, the amount will be automatically refunded within 5–7 working days."

## Why
- `payment_attempts` is the single History source of truth — `payment_records` and `fee_audit_log` continue in parallel for receipts and general audit.
- Idempotency prevents duplicate offline payment records on retry.
- High-value re-auth provides a second factor for large cash transactions.
- Audit log is append-only by design.
- `fee_structures` is separate from `fee_records` — templates vs invoices.
- Bulk invoice generation uses `existingSet` check (studentId:feeType composite key) to prevent double-billing within a session.
