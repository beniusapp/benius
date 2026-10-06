---
name: Shared Support Staff academic-session foundation
description: Product constraints for Support Staff using the existing school academic-session selector.
---

Support Staff and Principal/Admin share the same school's AcademicSession records, session IDs, and school-wide active session. Each signed-in browser may keep its own selected view session.

School Setup, including academic-session management and school configuration, is Principal/Admin-only. Legacy School Setup permission values must not grant Support Staff access. Support Staff may still select sessions to view modules they are allowed to use; session selection is not management permission.

**Why:** The user explicitly separated School Setup management from the shared academic-session selector.

**How to apply:** Scope session-list reads to the authenticated account's school and preserve selector access independently of School Setup grants. Keep session-management and School Setup APIs Admin-only, and keep module access separate from session viewing. Archived reads remain limited to a granted module's existing history support, and archived writes must fail rather than fall back to the active session.
