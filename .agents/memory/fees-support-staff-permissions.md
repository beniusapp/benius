---
name: BENIUS Fees Support Staff permissions
description: Durable access boundaries for the Web/API Fees & Payments Support Staff correction.
---

Support Staff access to Fees & Payments is limited to explicitly granted areas: Financial Analytics, Fee Structures, Ledger & Transactions, Reminders, and Audit Log. External Portal, refunds, bulk invoice generation, and bulk deletion stay Admin-only. Use a Fees-scoped class-options endpoint rather than broadening general school-config or whole-school student-roster access. Do not persist synthetic Support Staff IDs into FK-backed user-reference columns; retain actor attribution through the audit actor resolver.

For legacy Fees grants, a parent-only grant or the complete legacy `view`/`record`/`export` trio maps only to Ledger & Transactions. Partial legacy sub-grants must not acquire a new area. Canonicalize the complete trio in the permission editor when a user is saved, so a later Ledger revocation is not silently undone by hidden legacy grants; do not run a data migration.

**Why:** Permission corrections must not expand access for existing Support Staff accounts, weaken tenant/session rules, or leave hidden old grants that prevent revocation.

**How to apply:** Keep these boundaries when extending Fees permissions or adjusting the Support Staff Fees UI/API. Preserve the existing Admin refund capability and school/academic-session scoping.
