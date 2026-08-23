---
name: External Portal re-authentication
description: Security boundary for sensitive External Payment Portal configuration.
---

External Payment Portal settings are school-global and must require server-side recent password verification in addition to normal admin authorization. The approval is tied to the authenticated administrator, their school, and a short expiry; it cannot cross a logout, user, or school change, but intentionally remains valid across academic-session switches.

**Why:** The tab exposes student-facing payment configuration and payment gateway credentials, but its configuration is owned by the school rather than an academic year. A modal alone is bypassable through direct API calls, while session-bound approval would falsely reject the same authorized school administrator after changing views.

**How to apply:** Gate every External Portal read and mutation—including credential and signature actions—with the same approval check. Only the exact, school-global portal mutation routes may bypass the academic archive write guard; all session-owned financial routes remain fail-closed. Use the shared session-aware request client for all tab requests, including uploads and deletes, but never use its selected-session header to derive approval or tenant identity.