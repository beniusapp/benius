---
name: Reply-aware Student Complaint alerts
description: Product rules for persistent unread state on the Student Dashboard Complaints module.
---

The Student Dashboard Complaints dot represents unread Teacher-to-Student complaints and newer Student-visible Teacher/Admin replies, including replies to resolved complaints that remain in history. Student-authored replies do not create unread alerts. Read status is persistent and scoped by school, student, and selected Academic Session. Preserve the existing module-level seen cursor for compatibility; it must not clear a Complaint that remains unread.

**Why:** the product requires a reply to a previously read Complaint to become unread again, which a once-per-Complaint receipt cannot represent.

**How to apply:** use forward-only notification activity created only for qualifying events after activation; never backfill or rewrite legacy receipts, and acknowledge only activity the Student successfully loaded. Do not infer the activation boundary from timezone-less timestamps or sequence allocation order.
