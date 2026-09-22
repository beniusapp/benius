---
name: Historical Attendance roster authority
description: Authority and fallback rules for selected-session Student membership and class/section in Attendance readers.
---

For selected-session Attendance reads, use the Session’s Enrollment as the first authority for historical class/section. If no Enrollment exists, an existing Attendance class/section snapshot remains valid evidence and must not be hidden. Never substitute the Student Registry’s current class/section for an archived Session.

For an active Session only, current active Registry members with no Enrollment must remain available so Enrollment never becomes a prerequisite for a Student’s first Attendance mark. Existing Attendance remains authoritative regardless of Enrollment presence.

**Why:** Historical Attendance must survive promotion, class/section changes, inactivity, and current-roster absence, while active Students must still be markable before any Enrollment or prior Attendance exists.

**How to apply:** Reuse the shared session-aware roster/context resolvers for Attendance, overview, analytics, and related examination readers. Preserve Enrollment-first precedence; use snapshots only when Enrollment is absent, and retain all school and Session predicates.