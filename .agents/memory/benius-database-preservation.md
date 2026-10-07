---
name: BENIUS database preservation
description: A migration-specific safety constraint for BENIUS databases across imports.
---

During the workspace port, a schema push against the populated development database stopped at an interactive warning that adding a unique constraint might require truncating an existing table. The inherited server's startup schema check subsequently passed without forcing that push.

**Why:** A force push or affirmative truncation could erase real school records. The port is meant to preserve existing behavior and data, not recreate the database.

**How to apply:** Do not run schema pushes automatically after task merges; install dependencies there, and handle database changes as a separately reviewed operation. Before any future schema push, inspect the proposed SQL and current records and resolve schema drift without deleting data. An imported workspace may have a fresh database rather than the populated database from the original project: inspect it first, and ask whether to initialize or restore school data. For new additive tables needed by the server's startup schema guard, keep reviewed migration SQL and an idempotent startup path ahead of that guard; otherwise a fresh deployment can block even the unchanged web app. A successful application startup alone does not authorize destructive schema changes. In this workspace, `executeSql({ environment: "development" })` targets a Replit-managed database that did not contain the BENIUS `schools` table, while the API's own development startup passed its schema guard using `DATABASE_URL`; do not assume those targets are the same, and verify database identity before querying or changing school data.

**Why:** A metadata check against the Replit-managed Development database found no BENIUS schema, while the application connects through its separate `DATABASE_URL`. The regular Drizzle push also stopped at an interactive schema-conflict prompt before applying changes; force-pushing risks unrelated populated sequences and data.

## Teacher Promotion session identity

Promotion decisions and overrides are isolated by school, session, and their exact cohort/student identity. Reads, upserts, and deletes must include the selected session; writes require that session to be active and the Student to have an active enrollment in the exact source cohort. Never infer a missing historical session from the current session.

**Why:** A Student can have independent Promotion outcomes in different school years; the old unscoped key could not represent both, and legacy rows may not have enough evidence for safe reassignment.

**How to apply:** Keep the database unique constraints, storage conflict targets, and API tenant/session checks aligned. Validate active enrollment for writes and use exact-session reads/deletes.

## Drizzle push scope safety

The project's Drizzle table filter does not make a partial push safe for its monolithic schema: a filtered or temporary partial schema can still produce unrelated global sequence changes.

**Why:** A Development push applied the intended Promotion DDL, then attempted to drop unrelated serial sequences and failed; subsequent catalog and row-count checks showed the target schema was applied and no sequence or application data was removed.

**How to apply:** Inspect generated SQL before schema pushes, reject out-of-scope DDL, never use force, and verify the live catalog after any failed push because it may have partially applied earlier statements.