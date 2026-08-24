---
name: First-session onboarding
description: The product constraint around creating and activating the first academic session for a new school.
---

The first academic session cannot rely on a previous session or on the normal rollover path. If creation defaults to draft/inactive, the admin experience must still provide an explicit, reachable activation decision; otherwise the new school can be left with no active session and an archive-labelled dashboard.

**Why:** The admin dashboard treats every `isActive = false` session as archive mode, while the session-management UI hides creation and activation controls in archive mode. This makes a draft first session operationally indistinguishable from an archived session and can strand onboarding.

**How to apply:** Any future first-session change should define the behavior for a school with zero sessions, verify the persisted `isActive`/`status` pair, and test the top-bar selection plus module access after creation.