---
name: Teacher self-attendance working days
description: Approved scope and historical interpretation for school-wide weekday settings and Teacher self-attendance rates.
---

Teacher self-attendance weekday settings are school-wide, not Session-versioned. The selected Session still strictly bounds the rate dates; a later weekday-setting change may recalculate the applicability of earlier Session dates, but must never reinterpret or rewrite the stored historical attendance status. Only All_School calendar holidays override applicability; targeted/class-specific holidays do not affect the general Teacher self-attendance rate.

**Why:** The owner approved the simpler school-wide configuration and explicitly excluded targeted holidays, while preserving historically recorded statuses.

**How to apply:** Keep rate eligibility separate from the timing/status engine and Student Attendance. If historical weekday snapshots are requested later, treat that as a new product/storage decision rather than silently adding Session-specific behavior.