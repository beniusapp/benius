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

**Promotion execution authority:** Web and approved Mobile Admin execution must use the shared server transaction, require an explicit target session and an exact weighted result-term key, recompute eligibility from complete applicable marks and current policy, and match a locked Teacher decision. Ignore client-supplied marks and destination decisions. Execution stages target-session Enrollment and history only; session activation performs the Registry synchronization.

**Why:** The user approved a strict backend contract so both execution paths enforce the same eligibility and old or ambiguous requests fail closed, while preserving the current Registry and source enrollment.

**How to apply:** Reject missing or ambiguous target/term inputs, incomplete results, or a missing/mismatched locked Teacher decision. Never update Student Registry placement directly during promotion execution.
