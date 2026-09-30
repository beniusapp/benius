---
name: Teacher Leave session boundaries
description: Session rules for Teacher Leave requests and the related Teacher-facing student leave queue.
---

Teacher-owned leave requests use the authenticated Teacher, their school, and an explicit academic session for reads. New requests and pending-request deletions require the current active session, and new request dates must fit fully inside that session. Leave records with a NULL session stay excluded from scoped reads and untouched; do not backfill them.

Leave policies and balances remain school-global/current. Policies have no academic-session field, and balances follow policy renewal periods across approved requests rather than academic years. The Teacher-facing student leave queue is selected-session scoped, its review actions are current-session writes, and its review history remains global and read-only.

**Why:** Changing academic-session request boundaries must not silently redefine leave entitlements or the separate student-leave review history.

**How to apply:** When changing Leave session routing, keep policy and renewal-period balance queries global unless the product explicitly introduces session-aware policy snapshots. Preserve the separate Student Leave and Admin workflows.