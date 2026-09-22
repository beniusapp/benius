---
name: Student Attendance calculation contract
description: Canonical status normalization, weights, missing semantics, and cross-surface calculation rule for Student Attendance.
---

All Student Attendance percentages shown to Students, Admins, or Teachers use one server-side interpretation: Present, Late, and Leave have weight 1; Halfday and Half_Day normalize together with weight 0.5; Absent and unknown statuses have weight 0.

Missing Attendance has weight 0 but remains missing/unmarked and never increments explicit Absent. Percentage precision is one decimal. Teacher self-attendance is a separate domain and does not use this contract.

**Why:** Independent formulas previously produced different percentages for identical Student Attendance records, especially for Late, Half Day, Leave, and missing records.

**How to apply:** Reuse the authoritative Student Attendance aggregation helper for every Student-Attendance calculation surface. Preserve selected-school/Session scope and Step 2H historical context. Working-day generation remains a separate concern.