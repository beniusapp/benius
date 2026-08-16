---
name: Concession Snapshot
description: Optional original fee / concession snapshot architecture — schema, utility, invoice paths, and receipt rendering.
---

## Rule
`fee_structures.amount` always means the final/net fee charged. `original_amount` is a new optional nullable integer added in Step 6. When provided, `original_amount >= amount` is enforced.

## DB columns added (Step 6)
- `fee_structures.original_amount INTEGER NULL` — gross fee before concession; NULL = not configured
- `fee_records.concession_snapshot JSONB NOT NULL DEFAULT '{}'` — immutable invoice-time snapshot

## Snapshot shape
```json
{ "original_amount": 3500, "concession_amount": 350, "concession_type": "merit", "concession_percent": 10 }
```
Empty = `{}` (no concession, or admin-direct invoice).

## buildConcessionSnapshot() — server/invoice-snapshot.ts
- null/undefined originalAmount → returns `{}`
- provided but invalid (≤0, NaN, Inf, originalAmount < amount) → throws (blocks invoice)
- valid → returns full snapshot; `concession_amount = original_amount - amount`

**Why:** Historical immutability — the fee structure may change after invoices are generated.

**How to apply:** Call in all 3 structure-based invoice paths (cron, auto-trigger, bulk). Admin-direct paths (offline pay, single-add) always store `{}` — no fee structure lookup.

## Invoice paths (structure-based)
All 3 paths call `buildConcessionSnapshot({ originalAmount, amount, concessionType, concessionPercent })` from the structure, alongside `buildBreakdownSnapshot`. Result stored in `concessionSnapshot` field of `createFeeRecord`.

## Receipt rendering (server/routes.ts)
Three display modes based on snapshot content:
1. `{}` (legacy/admin-direct) → existing behavior (single fee-type row or components+Net Fee)
2. `original_amount` present, concession-only path → Original Fee row + Concession row (if >0) + Net Fee row
3. components + concession → component rows + Original Fee row + Concession row + Net Fee row
Net Fee is always `fee_records.amount`. Total = `fee_records.amount + late_fee_paid`. Never reads `fee_structures`.

## Admin transaction-detail endpoint (server/fees-routes.ts)
Added `concessionSnapshot` field to the response. Source: `feeRow.concession_snapshot` (defensive: `{}` fallback).

## Admin UI (client/src/pages/admin-modules/fees-manager.tsx)
Added "Original Fee (₹) — Optional" input field with real-time validation (shows error when origAmt < amount, shows derived concession amount when valid). `originalAmount: null` when not provided. Server-side cross-field validation via `.superRefine()` in `structureBodySchema`.
