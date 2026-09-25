---
name: BENIUS database preservation
description: A migration-specific safety constraint for the populated BENIUS database.
---

During the workspace port, a schema push against the populated development database stopped at an interactive warning that adding a unique constraint might require truncating an existing table. The inherited server's startup schema check subsequently passed without forcing that push.

**Why:** A force push or affirmative truncation could erase real school records. The port is meant to preserve existing behavior and data, not recreate the database.

**How to apply:** Do not run schema pushes automatically after task merges; install dependencies there, and handle database changes as a separately reviewed operation. Before any future schema push, inspect the proposed SQL and current records and resolve schema drift without deleting data. A successful application startup alone does not authorize destructive schema changes.