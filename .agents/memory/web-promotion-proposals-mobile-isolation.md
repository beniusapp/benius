---
name: Web promotion proposals and Mobile isolation
description: Keep Web-only principal proposals out of the shared override data read by Mobile.
---

**Rule:** New Web Principal promotion proposals are durable audit events, not rows in the shared `promotion_overrides` table. Web execution may use only an exact, current audited proposal through its trusted Web-specific resolver after revalidating the locked Teacher snapshot. The unchanged Mobile path remains Teacher-led.

**Why:** Mobile reads the raw shared override table and its execution contract is frozen until Web rules are finalized. Separating Web resolution prevents proposal state from changing Mobile-visible behavior while preserving the Teacher ledger as the source of validation.

**How to apply:** Keep proposal reads and audited final-decision evidence Web-specific; do not change Mobile files or contracts until explicitly authorized. Validate the exact current proposal against the Teacher snapshot, and never treat legacy raw rows as authority for new execution.
