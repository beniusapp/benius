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
- Client generates a random `idempotencyKey` before POST.
- Server checks `getPaymentRecordByIdempotencyKey(key)` — if found, returns existing record with `idempotent: true` (HTTP 200).
- Prevents duplicate submissions on retry.

## High-Value Payment Re-Auth
- Payments ≥ ₹10,000 require `adminPassword` field in the POST body.
- Server does `bcrypt.compare(adminPassword, users.passwordHash)`.
- If `adminPassword` missing → HTTP 402 `{ requiresConfirm: true }`.
- Frontend catches the 402, stores pending payload, shows password dialog (step="confirm"), re-submits with `adminPassword`.
- After successful recording: RecordPaymentModal transitions to step="done" (not auto-close) showing Print Receipt button.

## Storage Summary Function
- `getFeeSummary(schoolId, sessionId?)` aggregates existing `fee_records` table (status=Paid → revenue, else → outstanding). Does NOT use new tables for the main summary.
- `offlinePaymentsCount` comes from `COUNT(*)` on `payment_records`.
- `getFeeStructureById(id, schoolId)` added for bulk-invoice generation.

## 5-Tab UI (fees-manager.tsx)
Tabs: Ledger & Transactions | Fee Structures | Reminders | External Portal | Audit Log
- MetricBar fetches `/api/admin/fees/summary` (staleTime 30s).
- LedgerTab reuses existing `/api/admin/fees` CRUD; adds Pay button per row → RecordPaymentModal.
- RemindersTab is static (D+0 / D+7 / D+14 / D+30 dunning schedule display).
- ExternalPortalTab: Toggle + URL + Banner + live student-facing preview.
- AuditTab: paginated, read-only, page size 20.

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
- **Why**: Admin may need receipts immediately after recording; auto-close would lose the payment ID needed to fetch the receipt.

## Student Portal Info (Task #18)
- `GET /api/student/fees/portal-info` — reads externalPaymentSettings for the student's school; returns `{ isEnabled, gatewayUrl, bannerMessage }`.
- Only returns isEnabled=true if the settings row exists AND isEnabled=true.
- student-fees.tsx: shows a cyan-bordered banner card above summary cards when isEnabled=true; "Pay Now" link opens gatewayUrl in a new tab.

## Why
- Idempotency prevents duplicate offline payment records when admins retry on network timeout.
- High-value re-auth provides a second factor for large cash transactions.
- Audit log is append-only by design (no endpoint exposed for mutations).
- `fee_structures` is separate from `fee_records` — it defines templates, not individual invoices.
- Bulk invoice generation uses `existingSet` check (studentId:feeType composite key) to prevent double-billing within a session.
