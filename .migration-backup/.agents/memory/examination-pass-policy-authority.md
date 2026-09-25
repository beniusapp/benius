---
name: Examination pass-policy authority
description: Defines the sole pass/fail threshold source and distinguishes it from grading bands, promotion rules, and legacy score fields.
---

Examination pass/fail decisions must use the authenticated school's grading tier that matches the student's class. A missing matching tier is a configuration error and must stop the calculation or report instead of falling back to a universal percentage.

**Why:** Historical code mixed configured percentages with runtime 33% and 35% defaults and stored per-score pass marks, allowing the same result to be classified differently across Teacher, Student, Admin, reports, and promotion evaluation.

**How to apply:** Resolve the threshold from tenant-owned class policy on the server and pass it explicitly to calculators and displays. Derive stored pass marks only for legacy compatibility; never read them as calculation authority. Keep grade-label boundaries and separately configured promotion-rule minimums distinct from pass/fail policy.