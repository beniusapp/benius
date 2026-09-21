---
name: Student recovery frontend authority
description: Frontend security and navigation rules for the Student forgot-password flow.
---

Student recovery routes may identify only the visible step. Never place challenge, reset-token, Student, school, or recovery-contact authority in URLs, browser storage, or client state. The next backend request determines whether the server-bound recovery session authorizes the step.

**Why:** Route access, refresh, and browser history are not proof of recovery authority. Pending requests can also complete after cancel, restart, or browser navigation and incorrectly force the UI forward.

**How to apply:** Keep recovery API bodies minimal and strict. Guard each pending operation with a generation token and expected route; invalidate it on route changes, unmount, cancel, and restart. Ignore stale callbacks and prevent older completion handlers from unlocking newer requests.