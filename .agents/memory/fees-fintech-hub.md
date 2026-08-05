---
name: Fees & Payments Fintech Hub
description: Architecture, constraints, and patterns for the refactored Fees & Payments module (4 new DB tables, fees-routes.ts, 5-tab UI) plus follow-up features.
---

## Tables Added
- `fee_structures` — fee templates (name, type, amount, frequency, applicable_classes, concession, due_day)
- `payment_records` — offline payment entries with idempotency_key UNIQUE constraint
- `fee_audit_log` — append-only audit trail (no update/delete endpoints)
- `external_payment_settings` — per-school UPSERT row (schoolId is UNIQUE)

## Backend Pattern
- All new routes live in `server/fees-routes.ts` → `registerFeesRoutes(app)`, called from `server/routes.ts` before `registerTeacherRoutes`.
- Registered BEFORE existing `/api/admin/fees` routes to avoid `:id` shadowing.
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
- **Why**: Admin may need receipts immediately after recording; auto-close would lose the payment ID needed to fetch the receipt.

## Tenant Security (payment write path)
- `POST /api/admin/fees/payments` validates studentId belongs to `req.session.schoolId` before insert.
- Also validates feeRecordId (if provided) belongs to same school AND same student.
- Idempotency key lookup is school-scoped.

## Payment Settlement Logic
- When a linked feeRecordId is provided, the backend sums ALL payment_records for that feeRecordId (including the new one) via `COALESCE(SUM(...), 0)`.
- Sets status to `Paid` if cumulative >= invoice amount, `Partial` otherwise.
- Supports installment scenarios correctly across multiple payment submissions.

## Archive Write Guard
- Payment modal uses `sessionFetch` (not raw `fetch`) so `x-view-session-id` header is always injected.
- Server-side `checkSessionContext` middleware rejects mutations against archived sessions with 403.

## Storage Summary Function
- `getFeeSummary(schoolId, sessionId?)` aggregates existing `fee_records` table (status=Paid → revenue, else → outstanding). Does NOT use new tables for the main summary.
- `offlinePaymentsCount` comes from `COUNT(*)` on `payment_records`.
- `getFeeStructureById(id, schoolId)` added for bulk-invoice generation.

## 5-Tab UI (fees-manager.tsx)
Tabs: Ledger & Transactions | Fee Structures | Reminders | External Portal | Audit Log
- MetricBar fetches `/api/admin/fees/summary` (staleTime 30s). **queryKey includes viewSessionId.**
- LedgerTab reuses existing `/api/admin/fees` CRUD; adds Pay button per row → RecordPaymentModal. **queryKey includes viewSessionId.**
- RemindersTab is static (D+0 / D+7 / D+14 / D+30 dunning schedule display).
- ExternalPortalTab: Toggle + URL + Banner + live student-facing preview.
- AuditTab: paginated, read-only, page size 20.

## Session-Scoping (Ledger & MetricBar only)
- `FeesManager` reads `selectedSession` from `useSessionView()`, derives `viewSessionId = selectedSession?.id ?? null`.
- Passes `viewSessionId` down to `MetricBar` and `LedgerTab` as a prop.
- Both include it in their React Query `queryKey` → per-session cache entries, correct refetch on session switch.
- Header shows a cyan badge with `selectedSession.sessionName` (amber "Archive — read-only" in archive mode).
- **Fee Structures, External Portal, and Audit Log are intentionally school-wide (no sessionId in their queryKeys).**
- Backend routes for `/api/admin/fees` and `/api/admin/fees/summary` already read `(req as any).viewSessionId` — no backend changes needed.
- `invalidateQueries({ queryKey: ["/api/admin/fees"] })` uses prefix matching and invalidates all session variants.

## Bulk Invoice Generation (Task #16)
- `GET /api/admin/fees/sessions` — convenience endpoint (wraps getAcademicSessions) for UI dropdown.
- `POST /api/admin/fees/structures/:id/generate-invoices` body: `{ sessionId, targetClasses[], dueDate }`.
- Logic: getEnrollmentsBySession → filter by targetClasses (empty = all) → skip if `${studentId}:${feeType}` already in existingRecords → createFeeRecord.
- Returns `{ created, skipped, total }`.
- UI: "Generate Invoices" button on each FeeStructure card → dialog with session picker, class checkboxes, due date, then result screen.

## Payment Receipt PDF (Task #17)
- `GET /api/admin/fees/payments/:id/receipt` — returns inline HTML (auto-print via window.print()).
- Shows: Receipt No (`payment.receiptNumber ?? PAY-{id}`), student name/ID/class, fee type, payment method, reference number, received date, amount. Cyan border, school name in header.
- RecordPaymentModal step="done": after success, stays open and shows Print Receipt button that opens the receipt in a new tab.

## Receipt Sequence System
- `receipt_sequences` table: `{ id, prefix VARCHAR(10) UNIQUE, current_number INTEGER DEFAULT 0 }` — seeded with OP=0, AF=0.
- `storage.nextReceiptNumber(prefix)` — atomic `INSERT … ON CONFLICT DO UPDATE SET current_number = current_number + 1 RETURNING current_number`. Self-seeds on first call. Returns e.g. `OP01`, `AF12`.
- **AF receipts**: generated in `POST /api/admin/fees` (routes.ts) and saved to `fee_records.receipt_number` (overrides any client-supplied value).
- **OP receipts**: generated in `POST /api/admin/fees/payments` (fees-routes.ts) BEFORE the transaction → stored in new `payment_records.receipt_number` column AND written to the linked `fee_records.receipt_number`.
- Deleting fee/payment records never touches `receipt_sequences` — numbers are permanent.
- **Why**: accounting requirement for non-reusable sequential receipt numbers.
- **Print button in ledger**: uses `paymentsByFeeRecordId.get(rec.id).find(p => p.cashierNotes !== "Auto-recorded…")` to get the most recent real payment ID (not REC-regex anymore).
- **Payment history modal**: shows `p.receiptNumber ?? PAY-{p.id}` as the receipt reference.

## Student Portal Info (Task #18)
- `GET /api/student/fees/portal-info` — reads externalPaymentSettings for the student's school; returns `{ isEnabled, gatewayUrl, bannerMessage }`.
- Only returns isEnabled=true if the settings row exists AND isEnabled=true.
- student-fees.tsx: shows a cyan-bordered banner card above summary cards when isEnabled=true; "Pay Now" link opens gatewayUrl in a new tab.

## Overdue Auto-Sweep (Task #20)
- `storage.markOverdueFeeRecords()` — single bulk UPDATE: `status='Due' AND due_date < today` → `status='Overdue'`. Runs across all schools in one query. Returns count.
- Scheduler in `server/index.ts`: `runOverdueFeeCheck()` called once on startup (catches missed records during downtime) + `setInterval(..., 24h)`.
- Log line `[fees] overdue sweep: N record(s) marked Overdue` only emitted when count > 0 (silent when nothing to update).
- `lt` from drizzle-orm is used for date comparison (already imported in storage.ts).
- `storage` imported in index.ts as a new import (was not there before).

## Razorpay Online Payment Gateway
- Credentials stored in `external_payment_settings` table: `razorpay_key_id`, `razorpay_key_secret`, `razorpay_webhook_secret`, `razorpay_mode` (test/live), `razorpay_enabled`. Migration run via direct SQL (not drizzle-kit push).
- GET external-settings: secrets are **masked** (`••••••••`) before returning to browser — never echoed in plaintext.
- PUT external-settings: if the masked placeholder is sent back unchanged, the secret is not overwritten (`undefined` spread pattern).
- `POST /api/payments/create-order` — creates Razorpay order via SDK; both student and admin sessions are accepted; returns `{ orderId, amount, currency, keyId }` (never secret).
- `POST /api/webhooks/razorpay` — HMAC verified against `req.rawBody` (captured by global express.json verify). Handles `payment.captured`: atomically assigns next `ON` receipt number, marks fee Paid, inserts paymentRecord (method=Online, referenceNumber=pay_XXXX), appends audit log.
- `ON` prefix seeded in `receipt_sequences` for all schools at migration time.
- Student portal-info endpoint now also returns `razorpayEnabled` and `razorpayKeyId` (never secret).
- Student-fees.tsx: Pay Now button on pending rows → loads Razorpay checkout.js dynamically → creates order → opens overlay → on success refetches fees after 2s. Online receipts show blue "Online" badge.
- Admin ExternalPortalTab: new Razorpay card above external portal URL section. Mode toggle (Test/Live), Key ID, masked Key Secret, masked Webhook Secret. Shows CONFIGURED badge when credentials are saved.
- **Receipt prefix convention**: AF = Add Fee (admin), OP = Offline Payment, ON = Online (Razorpay).

## Why
- Idempotency prevents duplicate offline payment records when admins retry on network timeout.
- High-value re-auth provides a second factor for large cash transactions.
- Audit log is append-only by design (no endpoint exposed for mutations).
- `fee_structures` is separate from `fee_records` — it defines templates, not individual invoices.
- Bulk invoice generation uses `existingSet` check (studentId:feeType composite key) to prevent double-billing within a session.
- Razorpay secrets are masked on GET so the browser never holds plaintext credentials after initial save.
