---
name: Production read-only query wrapper
description: How to interpret a production database query that returns transaction wrapper text instead of result rows.
---

Some grouped, joined, or duplicate-detection production reads can report success while returning only `START TRANSACTION` / `ROLLBACK`, with no query rows.

**Why:** This occurred repeatedly during Publish prechecks while simple scalar counts and schema introspection returned normally. Wrapper-only output is not evidence that a constraint precheck passed.

**How to apply:** Split complex production checks into smaller read-only queries and rely only on outputs that contain the expected result columns. If the wrapper-only behavior persists, state the verification limitation explicitly instead of assuming zero duplicates or orphans.