# Stage 3B-4 Phase B1: disposable local PostgreSQL

This is test-support documentation only. It does not configure the BENIUS API,
Web app, normal database pool, or any workflow. Phase B1 intentionally does not
run application database tests.

## Prepared instance

The current disposable instance is stopped and retained for owner review:

| Property | Value |
| --- | --- |
| Temporary cluster directory | `/tmp/benius-stage3b4.1e446f1c807e44c19b7aa7efb28a56f0` |
| PostgreSQL data directory | `/tmp/benius-stage3b4.1e446f1c807e44c19b7aa7efb28a56f0/data` |
| Unix socket directory | `/tmp/benius-stage3b4.1e446f1c807e44c19b7aa7efb28a56f0/socket` |
| PostgreSQL major version | 16 (16.10) |
| Port in the private socket filename | `55432` |
| Database | `benius_stage3b4_test` |
| Test role | `benius_stage3b4_test` |
| Cluster identifier | `32455e68-5c64-47b7-a730-b2d5169da14c` |
| Marker key | `e628dd40-4f83-4771-a315-fecc6268e0ba` |
| Database objects outside system schemas | `stage3b4_meta.cluster_identity` only |

The server is configured with an empty `listen_addresses`, a private Unix socket,
and `pg_hba.conf` rules that allow only the peer-authenticated local bootstrap
role or the password-authenticated test role on this exact database. Other
local-role and TCP rules reject connections. No system-wide PostgreSQL
configuration was changed.

The test role is not a superuser and cannot create roles or databases. It owns
only the disposable test database, has a five-connection limit, and can read
the setup-owned identity marker. The marker schema is not writable by the test
role. The bootstrap role is peer-authenticated as the workspace's non-root
`runner` OS user.

## Verify or restart this instance

Do not use an application connection string. Do not print the password, URL, or
shell variables; do not enable shell tracing. Keep start, verification, and stop
in one shell invocation, with the stop trap in place:

```bash
set -euo pipefail
BASE=/tmp/benius-stage3b4.1e446f1c807e44c19b7aa7efb28a56f0
DATA="$BASE/data"
SOCKET="$BASE/socket"
PORT=55432

stop_test_server() {
  if pg_ctl -D "$DATA" status >/dev/null 2>&1; then
    pg_ctl -D "$DATA" -m fast -w stop
  fi
}
trap stop_test_server EXIT

pg_ctl -D "$DATA" -l "$BASE/server.log" -w start
password=$(cat "$BASE/role-password")
socket_query=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$SOCKET")
test_url="postgresql://benius_stage3b4_test:${password}@localhost:${PORT}/benius_stage3b4_test?host=${socket_query}"
BENIUS_STAGE3B4_TEST_DATABASE_URL="$test_url" \
  node artifacts/api-server/test-support/stage3b4-b1-runner.mjs \
  --verify-isolation --metadata "$BASE/identity.json"
unset password test_url
```

The URL exists only in that child process's environment; it is not written to
the project or Replit environment. The runner constructs its PostgreSQL client
with the validated socket directory, port, database and role, and verifies the
server cluster identifier and setup-owned marker. It does not read the
application's general database setting. A call with no action or a request to
run application tests is refused.

For a standalone clean stop, use the exact data directory:

```bash
pg_ctl -D /tmp/benius-stage3b4.1e446f1c807e44c19b7aa7efb28a56f0/data -m fast -w stop
```

The workspace command runner did not reliably retain a detached server after a
shell call ended. Therefore, do not rely on this instance remaining live across
calls: run any future start/use/stop sequence in one controlled command with a
stop trap. No persistent auto-start is configured.

## Cleanup and restart behavior

The instance is deliberately **not deleted** at the end of Phase B1 so the
owner can review it. After that review and any separately approved work, safe
disposal requires all of the following:

1. Confirm `pg_ctl -D "$BASE/data" status` reports no server.
2. Confirm `realpath "$BASE"` equals the exact directory shown above and
   `cat "$BASE/data/PG_VERSION"` is `16`.
3. Confirm `identity.json` names that same base, database and cluster ID.
4. Only then remove that exact directory; never use a wildcard or a
   caller-supplied unvalidated path.

If Replit restarts the workspace, `/tmp` is scratch storage and the cluster,
password file and metadata may be cleared. The PostgreSQL process has no
automatic startup. Recreating it requires repeating the Phase B1 preflight and
initializing a **new unique** `/tmp/benius-stage3b4.*` cluster with the same
local-only rules. This does not require reading, copying, changing, or connecting
to Development data. Re-creation was not separately tested.

If a shell or server crashes, first check the exact cluster with `pg_ctl status`
and inspect only its own `postmaster.pid`, socket directory and server log.
Do not stop another PostgreSQL service, remove stale files by wildcard, or
delete this cluster automatically; retain it for review or create a new unique
cluster after preflight.

## Credential and resource boundary

The generated test password is in `role-password` under the mode-0700 temporary
directory; the file is mode 0600. Its value was not printed, logged, or stored
in the repository. The guard process receives the URL briefly through its
environment. Other processes running as the same `runner` OS user can access
that file or inspect same-user process metadata; this is not an OS-user
security boundary. No existing secret or application session secret is used.

At the observed run, the cluster occupied approximately 46 MB on disk and its
PostgreSQL process tree used approximately 66 MB RSS. The workspace limit was
8 GiB memory and 4 CPUs. Additional Replit resource-credit or charge impact
cannot be confirmed from this workspace audit.
