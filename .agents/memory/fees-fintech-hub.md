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
- Shows: Receipt No (PAY-{id}), student name/ID/class, fee type, payment method, reference number, received date, amount. Cyan border, school name in header.
- RecordPaymentModal step="done": after success, stays open and shows Print Receipt button that opens the receipt in a new tab.

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

## Why
- Idempotency prevents duplicate offline payment records when admins retry on network timeout.
- High-value re-auth provides a second factor for large cash transactions.
- Audit log is append-only by design (no endpoint exposed for mutations).
- `fee_structures` is separate from `fee_records` — it defines templates, not individual invoices.
- Bulk invoice generation uses `existingSet` check (studentId:feeType composite key) to prevent double-billing within a session.
