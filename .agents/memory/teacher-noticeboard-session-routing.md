---
name: Teacher Noticeboard session routing
description: Session and privacy boundaries for Teacher Noticeboard feeds, writes, and the legacy Dashboard badge.
---

Teacher Noticeboard content reads must carry the explicitly selected school session. Historical sessions remain readable, but writes are allowed only for the current session. Null-session notices are unassigned legacy data and must not be treated as global content.

The existing Teacher Dashboard badge request is sessionless. Preserve that compatibility behavior without returning notice content; it only needs notice IDs. A future Dashboard change should be scoped separately rather than weakening Noticeboard session checks.

**Why:** The Dashboard was outside the Noticeboard correction scope, but its old badge request still depends on a sessionless endpoint. Returning IDs preserves the existing count without exposing cross-session notice text or attachments.

**How to apply:** Keep Teacher Web and Mobile content requests explicitly session-scoped, and include school, session, owner, and Teacher creator role in operational mutation predicates. If the badge should become session-aware, update its caller and scope intentionally.