---
name: Teacher Complaint session boundaries
description: Project policy for session-scoped Teacher Complaint reads, writes, and student relationships.
---

Teacher Complaint access is tied to the explicitly selected, same-school academic session. Same-school historical records may be read, but Teacher writes require the selected session to be active. A missing session must not fall back to the active session.

Complaints with a null session remain unassigned legacy data: do not treat them as global and do not backfill or migrate them. Resolve Student membership, placement labels, and assigned-class access from enrollment in the selected session, not the Student's current profile.

**Why:** `session_id` is nullable for legacy records, and a Student's present-day placement may differ from their historical placement. Implicit fallback or profile-based checks can expose records across sessions.

**How to apply:** Carry one selected session through Teacher Complaint API, Web, Mobile, and attachment requests. Keep read and write modes distinct, and require the legitimate Teacher ownership or selected-session assignment relationship in addition to school/session scope.