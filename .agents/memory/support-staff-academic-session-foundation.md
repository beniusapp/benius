---
name: Shared Support Staff academic-session foundation
description: Product constraints for Support Staff using the existing school academic-session selector.
---

Support Staff and Principal/Admin share the same school's AcademicSession records, session IDs, and school-wide active session. Each signed-in browser may keep its own selected view session.

**Why:** The user specified these as product rules for the Support Staff selector correction.

**How to apply:** Scope session-list reads to the authenticated account's school. Keep session-management actions Admin-only and module access separate from session viewing. Archived reads remain limited to a granted module's existing history support, and archived writes must fail rather than fall back to the active session.
