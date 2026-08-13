---
name: Production DB Schema Gap — payment_records columns
description: Production database was missing columns that were added manually to dev DB. Pattern for safe migrations and reconciliation.
---

## The Problem
Columns added directly to the dev database (via `node -e` SQL) are NOT automatically present in the production database. When the app was deployed, the production `payment_records` table was missing: `bank_name`, `card_last4`, `vpa`, `payer_name`, `payer_email`, `payer_contact`, `gateway_status`.

The webhook handler tried to INSERT with these fields → crashed with `column "bank_name" does not exist` → returned HTTP 500 → Razorpay retried 5 times and gave up → payment_record was never created. The old (pre-Task #191) code had already marked fee_record as Paid before the INSERT, creating an orphan.

## The Fix Pattern
All schema additions belong in the startup migration block in `server/index.ts` using:
```sql
ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS bank_name TEXT;
```
This is idempotent — runs on both dev and production safely on every boot, no-ops if column exists.

**Why:** Direct `node -e` SQL commands only affect the database the dev server is connected to. Production gets its own separate database. Startup migrations are the only guaranteed way to sync schema to production.

## Orphan Reconciliation Pattern
When a Paid fee_record exists with no payment_record (caused by the INSERT crash), the startup migration now auto-reconciles:
```sql
INSERT INTO payment_records (...)
SELECT ... FROM fee_records fr
WHERE fr.status = 'Paid' AND fr.receipt_number LIKE 'ON%'
  AND NOT EXISTS (SELECT 1 FROM payment_records pr WHERE pr.fee_record_id = fr.id)
ON CONFLICT (idempotency_key) DO NOTHING
```
Uses `rzp_reconstructed_<receipt>` as idempotency_key. Safe to run every boot.

## Idempotency guard on webhook
`payment.captured` webhook handler checks `if (feeRec.status === 'Paid') return 200 idempotent` BEFORE doing any DB writes. So even if Razorpay retries after reconciliation, no duplicate is created.

**How to apply:** Any time a new column is needed in the code (Drizzle schema or raw SQL INSERT), add it to the startup migration block in `server/index.ts` immediately — never rely on manually running ALTER TABLE in dev only.
