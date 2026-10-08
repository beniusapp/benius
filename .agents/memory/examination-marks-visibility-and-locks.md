---
name: BENIUS exam marks visibility and locked-ledger protection
description: Web Student-visible marks saves and the exact locked-ledger write boundary.
---

**Rule:** Successful authorized Web Teacher mark saves or corrections make only the changed rows Student-visible; untouched unpublished scores remain unchanged. Reject edits that affect an exact locked cohort decision term or its configured failed-subject/cumulative dependencies until an authorized correction path exists. Keep Mobile frontend and business logic frozen; the shared lock guard may fail closed there, but Web-only validation and publication behavior must not leak into Mobile.

**Why:** The user approved immediate Web visibility, no historical bulk publishing, and a 409 lock until an authorized correction workflow, while preserving Mobile behavior.

**How to apply:** Set the existing published flag only for successful Web score writes. Keep the lock check shared and scoped to school, session, class, section, and actual policy dependencies.
