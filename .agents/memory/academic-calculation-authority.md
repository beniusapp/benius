---
name: Academic calculation authority
description: Durable rules for authoritative academic results and promotion evaluation.
---

An academic result is authoritative only after resolving exactly one school-owned grading policy and Exam Policy for the student's enrollment-derived class in the selected session. Required subjects and weighted components must be complete; duplicates, invalid marks, ambiguous policies, and missing required attendance data block the verdict.

**Why:** Independent portal calculations previously disagreed on policy fallbacks, partial-weight normalization, grade bands, attendance, rounding, and promotion rules. Returning `false` for incomplete data also incorrectly presented a configuration/data failure as an academic failure.

**How to apply:** Use the backend academic calculation service for result and promotion decisions. Keep system verdicts separate from teacher/admin decisions. Represent incomplete evaluations with `promoted: null`, never a fallback pass/fail.