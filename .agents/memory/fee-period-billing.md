---
name: Fee Period & Billing Schedule
description: Architecture and key decisions for fee_period_start/fee_period_end on invoice records, billingTiming on fee structures, and the period computation + display logic.
---

## The rule
Every fee invoice permanently records the billing period it represents (`fee_period_start` / `fee_period_end` DATE columns on `fee_records`). These are set at creation time and never changed. Period is independent of due date, generation date, or payment date.

**Why:** Multiple schools bill the same period at different times (advance vs. arrears). The period must be stored, not re-derived, so receipts and display always reflect the original intent.

## New DB columns
- `fee_structures.billing_timing VARCHAR(10) DEFAULT 'advance'` — "advance" | "arrears" (ignored for annual/one-time)
- `fee_records.fee_period_start DATE` — null for pre-migration records
- `fee_records.fee_period_end DATE` — null for pre-migration records

## Quarter convention
Calendar quarters (NOT Indian academic quarters):
- Q1: Jan–Mar, Q2: Apr–Jun, Q3: Jul–Sep, Q4: Oct–Dec

## computeFeePeriod(frequency, billingTiming, referenceDate, session?)
Located in `server/fee-period.ts`. Pure function, no side effects.
- monthly/advance: period = the month of referenceDate
- monthly/arrears: period = the prior month
- quarterly/advance: period = the current calendar quarter
- quarterly/arrears: period = the prior calendar quarter (wraps year boundary correctly)
- annual/one-time: period = session.startDate to session.endDate (fallback: April to March of next year)

## feePeriodLabel(start, end, academicYear?)
- ≤31 days → "August 2026" (month + year)
- ≤92 days → "April–June 2026" (quarter range)
- >92 days → uses academicYear string if provided, else derives "2025–26"
- Null/empty start → falls back to academicYear, then "—"

## Dual idempotency key pattern
Pre-migration records have null feePeriodStart. The cron and generate-invoices routes use TWO maps:
1. `existingByPeriodStart`: keyed on `studentId:feeType:feePeriodStart` (new records only)
2. `existingByDueMonth` / `existingByType`: keyed on `studentId:feeType:YYYY-MM` or `studentId:feeType` (null-period records only)

**How to apply:** Any code that creates fee records must check BOTH maps before inserting. New records always write feePeriodStart/feePeriodEnd.

## Receipt period row label
The receipt's Payment Audit box shows a period row only when feePeriodStart is set:
- days ≤31 → label "Fee Month"
- days ≤92 → label "Fee Period"
- days >92 → label "Academic Session"
Value = feePeriodLabel(rec.feePeriodStart, rec.feePeriodEnd, rec.academicYear)

## Student portal
`feePeriodLabel` is computed server-side in the student fees API enrichment and sent as `feePeriodLabel` on each record. The fee card shows "Fee Period: August 2026" only when `feePeriodLabel` is non-null and differs from the academicYear string.

## Admin UI (fees-manager.tsx)
- billingTiming dropdown appears only when frequency is monthly or quarterly
- Generate Invoices modal shows a period picker (dropdown, 6 past + current + 2 future) for monthly/quarterly
- Period picker pre-selects the correct period based on structure's billingTiming
- Annual/one-time: period derived from selected session's startDate/endDate automatically

## Test coverage
42 focused tests in `server/__tests__/fee-period.test.ts` covering all 4 billing combos, idempotency, multi-tenant, label display, backward compat, and receipt row label. All pass as of implementation.
