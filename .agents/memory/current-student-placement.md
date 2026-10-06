---
name: Current Student placement
description: The relationship between Student Registry placement, active-session enrollment, and historical session records.
---

**Rule:** Authorized Web Student Registry Add creates the Student and active-session enrollment atomically. A placement-changing Edit of an active Student updates only the active-session enrollment in the same transaction. Non-placement edits do not touch enrollment; enrollment-history reads never repair or mutate records.

**Why:** The user designated the current Student Registry profile as the source for current placement while keeping session enrollment authoritative for session-sensitive modules and historical enrollment intact.

**How to apply:** Validate Class and Section against school configuration and require exactly one active session for Add or an active Student's placement change. Preserve enrollment status on update. Do not alter historical sessions or Attendance records.

**Promotion preparation boundary:** Stage 2 Promotion creates or confirms a target-session enrollment with no roll number and records both source and target sessions in history. It changes neither Student Registry placement nor source enrollment, and it does not activate or otherwise change the target session. A later placement/activation stage must be explicit.

**Why:** The user defined Stage 2 as preparation for a chosen target session, not as moving the Student's current placement.

**How to apply:** Keep preparation separate from Registry Add/Edit synchronization. Do not treat an existing target enrollment or a prepared Promotion as permission to rewrite current placement or activate a session.
