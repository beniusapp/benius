---
name: Examination grade-policy authority
description: Defines tenant-scoped Examination grade selection, inclusive range semantics, and its separation from pass/fail.
---

Examination grades must be selected only from the authenticated school's class-matching grading rules. Each configured `minPercent` and `maxPercent` is an inclusive bound. Rules must be non-empty, use valid integer bounds, have `minPercent < maxPercent`, and contain neither overlapping nor non-adjacent integer ranges. A percentage that matches no range is a configuration error; no universal A–F table may be substituted.

**Why:** The policy UI and server resolver established explicit min/max ranges, while several Teacher, Student, Admin, and report paths independently used lower-bound-only or hardcoded A–F calculations, producing inconsistent grades across tenants and screens.

**How to apply:** Resolve the class tier and rules from the authenticated school on the server, carry that school identity into shared calculations, and use the shared grade selector in every Examination display/report. Keep grade selection independent from pass percentage and promotion rules.