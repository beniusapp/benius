---
name: Teacher Dashboard session boundaries
description: Session ownership rules for aggregate counts and current-day status shown on Teacher Dashboards.
---

Dashboard aggregates should follow the selected academic session when they describe session-owned records. This includes pending profile approvals and the Web Noticeboard unread badge; include the session in both the request and its query-cache identity.

The Web Dashboard's current-day Attendance indicator is operational status for today, so it must use the active session even while the Teacher views an archive. Teacher identity, school, and current assignment summaries remain current/global; do not invent historical Teacher assignment snapshots or change the underlying modules when fixing Dashboard aggregates.

**Why:** Historical student enrollment can differ by session, while Teacher assignments and today's operational status do not have historical snapshots.

**How to apply:** When changing a Dashboard badge or status, classify the underlying record first: use the selected session for historical/session-owned counts, the active session for current-day operations, and current/global data for Teacher identity and assignments.