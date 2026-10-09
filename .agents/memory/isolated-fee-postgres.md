---
name: Disposable fee-test PostgreSQL
description: Safety lessons for isolated BENIUS Fees verification clusters.
---

Use a workspace-local PostgreSQL cluster bound only to its private Unix socket and a non-default port. Keep the test login non-superuser. Verify cluster identity with `pg_controldata` and effective bind/socket settings from the cluster configuration or `postgres -C`; ordinary roles cannot read some protected settings such as `unix_socket_directories`. Parent shells may already contain database connection variables, so launch PostgreSQL, `psql`, and app-test processes with `env -i` and pass only the explicit disposable socket URL and required runtime settings; never inspect or inherit those ambient values.

**Why:** Granting broad settings visibility just to inspect one protected setting would weaken least privilege. A detached PostgreSQL process started in one shell execution did not survive until a later execution in this environment, and ambient database variables could point test clients at a non-disposable database.

**How to apply:** For separately approved database verification, start the isolated cluster and run all checks in one shell execution; use `env -i` for every database/app process with explicit socket, port, database, role, and test-only authorization settings. Validate identity before schema/data work; run zero-table guards before setup and rely on runtime identity checks after setup.
