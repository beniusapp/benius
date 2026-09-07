---
name: Examination grade-policy authority
description: Defines tenant-scoped Examination grade selection, inclusive range semantics, and its separation from pass/fail.
---

Examination grades must be selected only from the authenticated school's class-matching grading rules. Each configured minimum and maximum is an inclusive bound from 0.00 through 100.00 with at most two decimal places. Decimal policies use exact hundredths for continuity and matching; unchanged whole-number policies retain their existing whole-number continuity. A percentage that matches no configured range remains a configuration error, and no universal A–F table may be substituted.

**Why:** Calculation paths legitimately produce decimal percentages, while integer-only storage could not express closed decimal bands. Existing tenant policies must not be silently expanded from a maximum such as 59 to 59.99.

**How to apply:** Resolve the class tier and rules from the authenticated school, map exact database numerics explicitly, and use integer hundredths for validation and selection. Keep pass percentage integer and keep grade selection independent from pass/fail, promotion, cumulative, and session rules.