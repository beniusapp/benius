---
name: BENIUS database preservation
description: A migration-specific safety constraint for BENIUS databases across imports.
---

During the workspace port, a schema push against the populated development database stopped at an interactive warning that adding a unique constraint might require truncating an existing table. The inherited server's startup schema check subsequently passed without forcing that push.

**Why:** A force push or affirmative truncation could erase real school records. The port is meant to preserve existing behavior and data, not recreate the database.

**How to apply:** Do not run schema pushes automatically after task merges; install dependencies there, and handle database changes as a separately reviewed operation. Before any future schema push, inspect the proposed SQL and current records and resolve schema drift without deleting data. An imported workspace may have a fresh database rather than the populated database from the original project: inspect it first, and ask whether to initialize or restore school data. For new additive tables needed by the server's startup schema guard, keep reviewed migration SQL and an idempotent startup path ahead of that guard; otherwise a fresh deployment can block even the unchanged web app. A successful application startup alone does not authorize destructive schema changes.

## Teacher promotion ledger session identity

Do not change the promotion-ledger schema or force existing records into a school year without explicit approval. Until the ledger can represent the same student/cohort/term independently for each academic session, selected-session writes must refuse to overwrite a record tagged to another session or an untagged legacy record.

**Why:** The existing conflict identity does not include academic session, and historical ledger rows cannot be assigned to a year with confidence. The Step 4 request did not authorize a schema migration.

**How to apply:** Keep reads scoped to the selected session, make conflicts explicit without partially saving, and treat a session-aware uniqueness migration plus safe legacy-data handling as separately approved work.