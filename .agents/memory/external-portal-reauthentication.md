---
name: External Portal re-authentication
description: Security boundary for sensitive External Payment Portal configuration.
---

External Payment Portal settings must require server-side recent password verification in addition to normal admin authorization. The approval is tied to the authenticated administrator, their school, the current selected academic session, and a short expiry; it cannot cross a logout, user, school, or selected-session change.

**Why:** The tab exposes student-facing payment configuration and payment gateway credentials. A modal alone is bypassable through direct API calls, and session-aware requests must preserve the selected session to avoid falsely rejecting authorized actions or reusing approval in another context.

**How to apply:** Gate every External Portal read and mutation—including credential and signature actions—with the same approval check. Use the shared session-aware request client for all tab requests, including uploads and deletes. Never obtain the approved user, school, or session from client-provided identity fields.