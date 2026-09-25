---
name: Publish foreign-key ordering
description: A development-to-production schema diff can order dependent foreign keys before newly added uniqueness constraints.
---

The generated publish diff can emit a composite foreign key before the uniqueness constraint it needs on the referenced table, even when the development schema has both. Converting a standalone unique index to a named unique constraint makes the constraint appear in the diff, but does not necessarily place it before the foreign key. Do not assume that a logically correct source schema produces an executable one-shot publish diff.

**Why:** A validation run failed because PostgreSQL required a unique key on the referenced composite columns. Comparing both database schemas showed that the key existed only in development. After expressing it as a constraint, a fresh publish diff still scheduled the dependent foreign key before the key.

**How to apply:** Compare development and read-only production catalogs and inspect the ordered statements from the live schema diff before suggesting a retry. If staging is necessary, preserve tenant integrity and existing data; never assume a migration file or a deploy-time script will reorder Replit's publish diff.