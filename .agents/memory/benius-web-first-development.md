---
name: BENIUS Web-first development direction
description: Product scope and security principles for future BENIUS changes.
---

For normal BENIUS requests, prioritize the Web app and only backend/database changes genuinely needed to support it. Keep Mobile feature and business-logic work frozen unless explicitly requested, and preserve the existing Mobile project and APIs. If a necessary shared backend change could alter Mobile behavior, explain the impact before editing where practical. Backend enforcement remains authoritative for authentication, tenant isolation, sessions, ownership, and validation. Avoid broad architecture refactors; reserve systematic Web/Mobile alignment for the later Mobile phase.

**Why:** The user set this direction to finish and stabilize Web before serious Mobile development.

**How to apply:** Scope ordinary features and fixes to Web plus genuinely required backend/database work. Do not automatically synchronize Web changes into Mobile.
