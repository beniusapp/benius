---
name: Reply-aware Student Complaint alerts
description: Product rules for persistent unread state on the Student Dashboard Complaints module.
---

The Student Dashboard Complaints dot represents unread Teacher-to-Student complaints and newer Student-visible Teacher/Admin replies, including replies to resolved complaints that remain in history. Student-authored replies do not create unread alerts. Read status is persistent and scoped by school, student, and selected Academic Session. Preserve the existing module-level seen cursor for compatibility; it must not clear a Complaint that remains unread.

**Why:** the product requires a reply to a previously read Complaint to become unread again, which a once-per-Complaint receipt cannot represent.

**How to apply:** use a persisted per-Complaint qualifying-note read cursor and only advance it to activity the Student successfully loaded. Keep the feature gated until a reliable baseline for legacy receipts is proven; the owner chose to pause rather than risk hiding newer replies or re-alerting on every previously read complaint. Do not guess across `TIMESTAMP WITHOUT TIME ZONE` and `TIMESTAMPTZ`.
