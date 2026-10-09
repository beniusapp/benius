---
name: Disposable fee-test PostgreSQL
description: Safety lessons for isolated BENIUS Fees verification clusters.
---

Use a workspace-local PostgreSQL cluster bound only to its private Unix socket and a non-default port. Keep the test login non-superuser. Verify cluster identity with `pg_controldata` and effective bind/socket settings from the cluster configuration or `postgres -C`; ordinary roles cannot read some protected settings such as `unix_socket_directories`.

**Why:** Granting broad settings visibility just to inspect one protected setting would weaken least privilege. A detached PostgreSQL process started in one shell execution did not survive until a later execution in this environment.

**How to apply:** For separately approved database verification, sanitize inherited connection variables, use explicit socket/port/database/role settings and a test-only authorization marker, validate the target before schema or data work, and start/check/stop the isolated server within one shell execution.
