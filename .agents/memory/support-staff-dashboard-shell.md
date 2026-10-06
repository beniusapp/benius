---
name: Support Staff dashboard shell
description: Support Staff dashboard summary visibility and read-only Teacher Removed History access.
---

Support Staff do not see the Admin dashboard's upper summary-card bar; omit the entire bar, including its wrapper and date pill, while leaving Principal/Admin cards unchanged. Removed History is read-only Teacher Registry base access: the parent grant is sufficient, no Add/Edit/Delete child is required, and both UI route guards and the API must enforce that parent grant using the authenticated school.

**Why:** The user requires historical viewing inside the existing dashboard shell without granting mutation permissions or exposing the Admin summary section to Support Staff.

**How to apply:** Keep Removed History in the shared Admin dashboard route and shell, map its route permission to `teacher-registry`, and keep the API session-scoped. Do not create a separate grant for history or add restore/edit/delete controls.
