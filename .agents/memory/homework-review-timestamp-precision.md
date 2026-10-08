---
name: Homework review timestamp precision
description: PostgreSQL timestamp precision must align with values exposed through JavaScript for safe optimistic concurrency checks.
---

Do not compare a PostgreSQL timestamp column for exact equality against a JavaScript `Date` reconstructed from JSON when the database value can contain microseconds. PostgreSQL can retain six fractional digits, while JavaScript `Date` and ISO JSON round-trip only milliseconds. Preserve one canonical precision end-to-end or use a concurrency token that retains the database value exactly; keep the existing row lock and status checks.

**Why:** A disposable database regression reproduced a false “submission changed” conflict on an unchanged Homework answer because the displayed millisecond timestamp differed from the stored microsecond timestamp.

**How to apply:** Check precision at both insert and review/update paths for timestamp-based optimistic concurrency, especially when defaults such as `now()` can generate sub-millisecond values.
