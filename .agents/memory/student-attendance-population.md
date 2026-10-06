---
name: Student attendance population
description: Eligibility rules for live attendance, school-wide daily presence, and historical attendance views.
---

For live attendance and Web Daily Presence, eligibility comes from the authenticated school, validated selected academic session, active Student, and Active enrollment in that same school/session. The enrollment’s class and section are authoritative for placement; current Student profile placement must not override it. Attendance rows never define the eligible population. An eligible Student without a record for the selected date is Not Marked, not Absent, and is excluded from the percentage denominator. Calculate the percentage from recorded statuses for eligible Students only, preserving existing status handling. Do not assume weekdays, infer attendance from a teacher schedule, or add a calendar/schema rule. Keep historical attendance readable through its separate history/snapshot path. Preserve real attendance; clear Development test marks only when the user authorizes it and the exact rows are verified.

**Why:** the user’s Daily Presence rule is “NOT MARKED ≠ ABSENT”; a missing row is a workflow state, not an attendance result. The school/session/enrollment boundary also prevents inactive or cross-session Students from changing live totals.

**How to apply:** keep live roster and historical report semantics separate. For Daily Presence, start from eligible active session enrollments across the school, then associate only that date’s records; show a Not Marked count and no percentage when no eligible Student has a mark. Never delete production or actual historical attendance to fix a summary.
