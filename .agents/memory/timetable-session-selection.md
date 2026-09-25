---
name: Timetable session selection
description: Why timetable API requests prioritize a selected Academic Session for all roles and operations.
---

Timetable requests select a school-owned Academic Session explicitly when one is supplied; otherwise they use the school's active Academic Session. This applies to Teacher writes as well as reads. An invalid or foreign selected Session is rejected, not replaced with the active Session. When neither is available, reject rather than read across Sessions.

**Why:** The user explicitly corrected an earlier audit that suggested Teacher mutations should use the active Session regardless of selection. That would make a Teacher's request act on a different Session from the one selected, risking misplaced changes.

**How to apply:** When changing Timetable API or transport behavior, preserve selected-over-active priority across Admin, Teacher, and Student roles. Keep the same resolved Session throughout a request, and continue blocking mutations to archived Sessions.