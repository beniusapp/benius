---
name: Teacher self-attendance Session identity
description: Durable migration and authority rules for Teacher self-attendance across academic Sessions.
---

New Teacher self-attendance reads and writes require a validated, tenant-owned academic Session. The same Teacher and calendar date may have separate rows in separate Sessions. Legacy rows with no Session remain nullable for compatibility but are not selected by Session-scoped operations.

**Why:** Academic Sessions can overlap calendar dates, so Teacher/date alone is not a valid identity. The development database represented the old named uniqueness as a table constraint, meaning a migration that only drops an index fails.

**How to apply:** Keep request transport, cache keys, queries, corrections, check-in/out, and detailed history bound to the selected Session. When replacing the named uniqueness, drop the table constraint if present and then the standalone index if present before creating the Session-aware unique index.