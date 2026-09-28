---
name: Teacher Timetable session routing
description: Scope rule for applying academic-session resolution to Teacher-only paths in shared timetable APIs.
---

Use the shared Teacher Academic Session resolver for Teacher Timetable reads (`SELECTED_SESSION_REQUIRED`) and current-only writes (`CURRENT_SESSION_WRITE`). For shared API routes, branch only for authenticated Teachers; do not globally replace the legacy resolver used by Admin and Student routes. On Mobile, apply the current-write mode only to Timetable save/delete actions so other Teacher modules retain their existing write guard.

**Why:** The older timetable resolver serves multiple roles and permits active-session fallback. Changing it globally can alter Admin or Student behavior; broad Mobile guard changes can alter unrelated Teacher modules.

**How to apply:** When extending session-aware Teacher functionality, derive Teacher and school from authentication, validate the selected session within that school, preserve non-Teacher branches, and test both Teacher rejection paths and Admin/Student fallback behavior.