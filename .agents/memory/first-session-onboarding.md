---
name: First-session onboarding
description: The product constraint around creating and activating the first academic session for a new school.
---

The first academic session cannot rely on a previous session or on the normal rollover path. For a school with zero academic sessions, creation automatically makes that session active; schools with session history retain their requested draft/active behavior.

**Why:** The admin dashboard treats every `isActive = false` session as archive mode, while the session-management UI hides creation and activation controls in archive mode. A draft first session is operationally indistinguishable from an archived session and can strand onboarding.

**How to apply:** Preserve the zero-session-only boundary, verify the persisted `isActive`/`status` pair, and test the top-bar selection plus module access after creation. Do not change multi-session activation or archive rules as part of first-session work.