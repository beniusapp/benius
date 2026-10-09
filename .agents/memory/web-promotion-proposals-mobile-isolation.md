---
name: Web promotion proposals and Mobile isolation
description: Keep Web-only principal proposals out of the shared override data read by Mobile.
---

**Rule:** New Web Principal promotion proposals are durable audit events, not rows in the shared `promotion_overrides` table. Existing raw rows remain read-only; only exact matching historical audit evidence may supply actor or reason. Web execution remains based on the locked Teacher ledger, not proposals.

**Why:** Mobile reads the raw shared override table, so adding Web proposals there would change Mobile-visible behavior even without editing Mobile code. Stage 3B-1 also keeps proposals disconnected from execution.

**How to apply:** Keep proposal reads Web-specific, leave Mobile raw readers unchanged, keep legacy rows non-editable, and do not use proposal state for execution. Validate target-session destinations in the separately scoped Stage 3B-2 work.
