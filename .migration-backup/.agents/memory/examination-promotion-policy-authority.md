---
name: Examination promotion-policy authority
description: Durable interpretation of Examination promotion thresholds, ownership, missing data, and deliberately unchanged behavior.
---

Promotion policy belongs to the authenticated school and must be evaluated only with that school's validated academic-session and student/result context. A client-provided school ID, score set, or foreign policy cannot select or alter the evaluation.

**Why:** Promotion was calculated in several places with hidden 3/35/75 defaults, inconsistent zero handling, and a server utility that accepted caller-provided scores without a student/session boundary.

**How to apply:** Use the shared promotion-rule evaluator. The four existing rules are:

- Failed-subject count is an inclusive retention trigger: a configured `N` retains when failures are greater than or equal to `N`. Zero is valid and therefore triggers even at zero failures.
- Attendance, current-term weighted average, and cumulative percentage are minimums: the exact threshold is eligible, and only a lower value violates the rule.
- Cumulative promotion applies only on its configured trigger term.
- Every enabled rule must have valid explicit configuration. Do not substitute universal 3, 33, 35, 40, or 75 values.
- Disabled rules are ignored. If no promotion rule is configured, fail as a configuration error.
- When an enabled rule's result input is unavailable, do not invent a violation; preserve the existing behavior and evaluate the available rules.
- Accumulate simultaneous violations and retain if any enabled rule is violated.

Pass/fail remains governed separately by the class grading tier's pass percentage. Grades remain governed separately by tenant grading ranges. Do not change attendance aggregation, weighting, cumulative arithmetic, roster behavior, Enrollment requirements, Faculty Mapping requirements, or scored/absent/missing semantics while applying this policy.