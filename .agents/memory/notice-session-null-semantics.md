---
name: Notice session null semantics
description: Why nullable legacy notice sessions should not be treated as global across school years.
---

Do not interpret a notice with no academic-session assignment as a school-wide notice valid in every session. "Whole school" is an audience, not a cross-year lifetime. The intent of older unassigned rows remains ambiguous.

**Why:** Notice creation may leave the session null when no active session exists, while session-scoped readers use strict session equality. Treating null as global would expose undated content to historical cohorts without an established product rule.

**How to apply:** Preserve strict selected-session visibility for Student reads. If legacy notices must be recovered, determine their intended year explicitly with the school before assigning a session; do not infer one or migrate records during unrelated portal work.