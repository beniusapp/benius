---
name: Invoice-First Offline Payment
description: The standalone-payment path (create invoice + payment in one step) was removed; offline payments must now link to an existing invoice.
---

## Rule
`POST /api/admin/fees/payments` requires `feeRecordId` (an existing invoice) unless `autoFifo=true`.
If `feeRecordId` is null and `autoFifo` is false the server returns 400 with a clear message.

**Why:** The old standalone path created invoices born already-Paid, bypassed all invoice lifecycle, left orphaned payment_records, and had no deduplication. Invoice-first ensures every payment attaches to a real invoice.

## What was removed from the backend schema (paymentBodySchema)
- `feeType`, `dueDate`, `feeStatus`, `academicYear` — all removed.
- The auto-create block (~40 lines, lines 1018-1058 of the old fees-routes.ts) was deleted.

## New endpoint
`GET /api/admin/fees/students/:studentId/unpaid-invoices`
Returns Due/Overdue fee_records with `accruedLateFee` and `totalDue` computed on the fly.
Ordered by `due_date ASC, id ASC`.

## Frontend
- `RecordPaymentModal` is now linked-only: `feeRecord` prop is required (non-nullable).
- `StandaloneOfflinePayModal` is the new multi-step component: search → select invoices → payment details → (confirm if ≥₹10k) → done.
- Parent wiring: `showPay` → `RecordPaymentModal` (guarded by `payTarget &&`); `showStandalonePay` → `StandaloneOfflinePayModal`.

## Test helper quirks (for future test files in this domain)
- Schools require a `code` field (`varchar(20) NOT NULL UNIQUE`).
- Students require `phone`, `dob`, and `passwordHash` as NOT NULL columns.
- `db.execute(sql`...`)` returns `{ rows: [...] }` not an array — use `result.rows[0]`, not `const [row] = await db.execute(...)`.

## How to apply
Any new offline payment feature must use the invoice-first path.
To record payment for a specific invoice: supply `feeRecordId`.
For bulk auto-allocation: supply `autoFifo: true` (existing invoices, FIFO order).
Never create a fee_record inside the payments endpoint.
