---
name: Transaction report authority
description: Durable scoping, fallback, and refund rules for transaction-level fee reports.
---

Resolve the invoice population first from the authenticated school, viewed academic session, canonical Ledger filters, and any selection or exclusions. The invoice session is authoritative; do not reject valid transactions because a payment row carries a different historical session stamp.

**Why:** Payment attempts and records can legitimately retain session stamps that differ from their invoice after historical migrations or delayed settlement. Filtering payment rows directly can hide valid audit history or expose the wrong selection semantics.

**How to apply:** Derive attempts and fallback payment records only from the resolved invoice IDs. Treat payment attempts as primary for every persisted outcome, include a payment record only when no attempt represents it, and keep every query tenant-scoped.

Only processed refunds change refunded money. Pending or requested refunds may be shown as status but must not reduce captured totals. Combine refund-table links by refund identity and honor the attempt-level provider projection without double-counting.

**Why:** Refunds can arrive through multiple webhook/admin paths with incomplete or overlapping links. Summing joins can duplicate money, while counting pending requests as processed misstates financial totals.

**How to apply:** Union matches across attempt ID, payment-record ID, and invoice plus provider payment ID; de-duplicate by refund ID. Compare the processed total with the attempt projection and use the larger persisted value.

Selection-aware transaction export uses POST as a read-only transport. Its exact report endpoint must remain usable in archived viewed sessions while ordinary POST mutations remain blocked.

**Why:** Explicit IDs and select-all exclusions do not fit safely in a GET query, but exporting an archived report does not modify historical data.

**How to apply:** Keep the archive-write-guard exception exact and route-specific; never generalize it to other fee POST routes.