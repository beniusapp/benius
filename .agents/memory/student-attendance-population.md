---
name: Student attendance population
description: Eligibility rules for live attendance, school-wide daily presence, and historical attendance views.
---

For live attendance, an enrollment row marked Active does not by itself make a deactivated Student eligible. Use the authenticated school, selected academic session, matching class and section, and active Student state for both roster display and write validation. Daily Presence must use the same eligible population across applicable classes, including eligible students with no mark yet; do not infer the entire school population only from attendance rows already written. Keep historical attendance readable through a separate history/snapshot path; do not delete enrollments or attendance records as a correction.

**Why:** the BENIUS attendance audit requirement distinguishes current attendance eligibility from preserved historical records and requires consistent school-wide denominators.

**How to apply:** keep live roster and historical report semantics separate, and derive applicable dates/classes from the attendance calendar or policy rather than from existing marks alone.
