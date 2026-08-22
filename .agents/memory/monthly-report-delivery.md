---
name: Monthly report delivery
description: Durable scheduling and delivery rules for Financial Analytics monthly email reports.
---

Automated Financial Analytics reports run per school on the administrator’s configured day and time in Asia/Kolkata, and each report covers the **previous completed calendar month**. If the chosen day does not exist in a month, use that month’s final day.

**Why:** Server-local scheduling and “current month” reports could send partial, incorrectly dated reports. A restart must not cause a completed recipient to receive the same period again.

**How to apply:** Treat report delivery as per-recipient, per-report-month state. Retry only recipients not marked delivered; use an ownership lease so stale workers cannot overwrite a newer attempt. Advance the schedule’s completed-month marker only across contiguous, fully delivered months, and replay unfinished months in chronological order after downtime. Manual sends use the same canonical report/PDF path but must not affect automatic delivery completion state.

Monthly report recipients are persisted as PostgreSQL `text[]` values, with every email bound as its own `ARRAY[...]` element rather than passing a JavaScript array through a generic SQL interpolation.

**Why:** A generic interpolation can flatten multiple values into one comma-delimited scalar, which PostgreSQL rejects as a malformed array literal.

**How to apply:** Keep API recipients as `string[]`, validate each address individually, and use explicit per-element parameter binding whenever writing the schedule.