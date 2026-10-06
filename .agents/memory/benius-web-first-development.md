---
name: BENIUS Web-first development direction
description: Product scope and security principles for future BENIUS changes.
---

For normal BENIUS requests, prioritize the Web app and only shared backend/database changes genuinely needed to support it. Until Web behavior is finalized, do not modify React Native/Mobile files, synchronize Web permission changes into Mobile, or redesign Mobile APIs. Keep Mobile feature and business-logic work frozen unless explicitly requested, and preserve the existing Mobile project and APIs. After Web is finalized, align Mobile module by module with the final rules. If a necessary shared backend change could alter Mobile behavior, explain the impact before editing where practical. Backend enforcement remains authoritative for authentication, tenant isolation, sessions, ownership, and validation. Avoid broad architecture refactors.

**Why:** The user set this direction to finish and stabilize Web before serious Mobile development.

**How to apply:** Scope ordinary features and fixes to Web plus genuinely required backend/database work. Do not automatically synchronize Web changes into Mobile.
