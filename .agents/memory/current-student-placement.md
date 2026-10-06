---
name: Current Student placement
description: The relationship between Student Registry placement, active-session enrollment, and historical session records.
---

**Rule:** Authorized Web Student Registry Add creates the Student and active-session enrollment atomically. A placement-changing Edit of an active Student updates only the active-session enrollment in the same transaction. Non-placement edits do not touch enrollment; enrollment-history reads never repair or mutate records.

**Why:** The user designated the current Student Registry profile as the source for current placement while keeping session enrollment authoritative for session-sensitive modules and historical enrollment intact.

**How to apply:** Validate Class and Section against school configuration and require exactly one active session for Add or an active Student's placement change. Preserve enrollment status on update. Do not alter historical sessions or Attendance records.
