---
name: Fee Component Snapshot
description: Immutable fee-component breakdown frozen into fee_records at invoice creation; architecture decisions and per-path rules.
---

# Fee Component Snapshot

## The rule
`fee_records.breakdown_snapshot` (JSONB NOT NULL DEFAULT '[]') is written ONCE at invoice creation from `fee_structures.breakdown`. It is never updated — not when the fee structure changes, not during amount sync for unpaid invoices.

## Source of truth
`server/invoice-snapshot.ts` — pure utility with two exports:
- `buildBreakdownSnapshot(unknown): BreakdownComponent[]` — validates + deep-copies; throws on empty name, negative/non-finite amount; returns [] for null/undefined/non-array; warns on duplicate names
- `warnOnSumMismatch(snapshot, invoiceAmount, context)` — console.warn only, never throws

## Five invoice creation paths
| Path | File | Snapshot behaviour |
|---|---|---|
| Monthly auto-invoice cron | server/index.ts | buildBreakdownSnapshot(structure.breakdown); skip structure on error |
| Auto-trigger | server/fees-routes.ts (POST .../auto-invoice/trigger) | buildBreakdownSnapshot; return 400 on error |
| Manual generate-invoices | server/fees-routes.ts (POST .../generate-invoices) | buildBreakdownSnapshot; return 400 on error |
| Offline auto-create invoice | server/fees-routes.ts | NO lookup — stays [] (DB default) |
| Admin single invoice | server/routes.ts | NO lookup — stays [] (DB default) |

**Why:** Paths 4 and 5 have no fee structure object available — introducing a structure lookup would change their semantics and is explicitly prohibited.

## `fee_structures.amount` semantics
`fee_structures.amount` is the NET amount entered by the admin (concession is NOT programmatically applied). Concession architecture requires a separate product decision.

## Legacy / pre-migration invoices
All existing fee_records have breakdown_snapshot = []. This is intentional. The receipt must check `breakdown_snapshot.length > 0` before rendering the component table — never reconstruct from current fee_structures.

## Step status (as of 2026-08-16)
- Step 1 ✅ Schema column added
- Step 2 ✅ Snapshot written at invoice creation
- Step 3 ⏳ Receipt rendering — NOT YET DONE (requires explicit approval)
- Step 4 ⏳ Admin transaction-detail dead code fix (feeRow.breakdown → feeRow.breakdown_snapshot)

## Test baseline
409 / 409 passing after Step 2 (384 existing + 25 new in server/__tests__/breakdown-snapshot.test.ts).
