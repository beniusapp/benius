---
name: Late Fee Engine
description: Architecture for the Late Fee & Penalty system in the Fees & Payments module.
---

## Schema additions
- `fee_structures.late_fee_config` — JSONB, default `{enabled:false, type:"NONE", ...}`. Type is `LateFeeConfig` exported from `shared/schema.ts`.
- `fee_records.late_fee_amount` — INTEGER NOT NULL DEFAULT 0; updated by the nightly cron.

## Core engine: server/late-fee-engine.ts
- `calculateLateFee(config, dueDateStr, status, referenceDate?)` — pure function, no DB; returns integer ₹.
- `recalculateLateFees(schoolId)` — loads all unpaid records + structures, calls calculateLateFee per record, persists to `fee_records.late_fee_amount`. Returns count updated.

## Wiring
- `server/fees-routes.ts` imports both helpers; calls `recalculateLateFees` (fire-and-forget) on POST and PATCH /structures.
- `server/index.ts` nightly cron (01:00) calls `recalculateLateFees` for every school after the overdue status sweep.
- `server/routes.ts` GET /api/admin/fees computes lateFeeAmount **on-the-fly** from the structure's lateFeeConfig (overrides stored value for real-time accuracy).

## Frontend (client/src/pages/admin-modules/fees-manager.tsx)
- `StructuresTab` has 7 new state vars: `lateFeeEnabled`, `lateFeeType`, `lateFeeGraceDays`, `lateFeeFlat`, `lateFeeDailyRate`, `lateFeeCap`, `lateFeeSlabs`.
- UI section inserted between the Due Date grid and Fee Breakdown section in the modal.
- Ledger Amount column shows "Base ₹X / +₹Y fine / Total ₹Z" when `rec.lateFeeAmount > 0`.

## Rule Types
- `FLAT` — one-time penalty (`flat_amount`)
- `DAILY` — `(daysOverdue - grace_period_days) * daily_rate`
- `TIERED` — array of `{from_day, to_day, amount}` slabs sorted ascending; uses last slab if beyond all defined ranges
- `max_cap` — applied after calculation (0 = no cap)

## Dynamic invoice details helper
`getInvoiceCurrentDetails(config, invoice, amountPaid, targetDate?)` — pure function returning `{ base_amount, accrued_late_fee, amount_paid, total_due }`. Used wherever a single invoice's payable breakdown is needed.

## payment_records.late_fee_paid (INTEGER, default 0)
Saved on every payment INSERT (both the regular path and FIFO path). Regular offline payments pass `lateFeePaid` from the admin modal payload; FIFO stores 0 (bulk allocation, no per-invoice fine split).

## API enrichment contract
Every fee record returned by GET /api/admin/fees and GET /api/student/fees now carries:
- `base_amount` — `rec.amount`
- `accrued_late_fee` — computed live from lateFeeConfig
- `total_due` — `base_amount + accrued_late_fee`
- `lateFeeAmount` — backward-compat alias for `accrued_late_fee`

GET /api/student/fees/summary outstanding totals include `fr.late_fee_amount` in the net-balance SQL.

## Razorpay / simulate-pay
create-order includes `late_fee_amount` in the Razorpay order amount (paise). simulate-pay records `amount + late_fee_amount` in the payment_record.

**Why stored + on-the-fly:** cron keeps stored value fresh for summary/FIFO endpoints; GET /api/admin/fees recomputes so the ledger is always current even before the next cron run.
