"use strict";

const { existsSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");

const TEST_URL_ENV = "BENIUS_STAGE3B4_TEST_DATABASE_URL";
const METADATA_PATH_ENV = "BENIUS_STAGE3B4_TEST_METADATA_PATH";
const STAGE2_FLAG = "BENIUS_STAGE2B_DEV_DB_TEST";
const STAGE3_FLAG = "BENIUS_STAGE3_DEV_DB_TEST";

function findRunner() {
  let current = process.cwd();
  while (true) {
    const directApiRoot = path.join(current, "artifacts", "api-server");
    const directRunner = path.join(
      directApiRoot,
      "test-support",
      "stage3b4-b2-runner.mjs",
    );
    if (existsSync(directRunner)) {
      return { apiRoot: directApiRoot, runnerPath: directRunner };
    }

    const packageRunner = path.join(
      current,
      "test-support",
      "stage3b4-b2-runner.mjs",
    );
    if (existsSync(packageRunner)) {
      return { apiRoot: current, runnerPath: packageRunner };
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  throw new Error(
    "Stage 3B-4 test guard could not locate its identity verifier; refusing database access.",
  );
}

function clearPostgresOverrides() {
  for (const name of [
    "PGHOST",
    "PGHOSTADDR",
    "PGPORT",
    "PGDATABASE",
    "PGUSER",
    "PGPASSWORD",
    "PGSSLMODE",
    "PGOPTIONS",
    "PGSERVICE",
    "PGSERVICEFILE",
    "PGCHANNELBINDING",
  ]) {
    delete process.env[name];
  }
}

function disabledDatabaseUrl() {
  const socket = `/tmp/benius-stage3b4-disabled-${randomUUID()}`;
  return `postgresql://disabled:disabled@localhost:1/disabled?host=${encodeURIComponent(socket)}`;
}

clearPostgresOverrides();
process.env.NODE_ENV = "test";

const stage2Enabled = process.env[STAGE2_FLAG] === "1";
const stage3Enabled = process.env[STAGE3_FLAG] === "1";
if (stage2Enabled && stage3Enabled) {
  throw new Error(
    "Stage 3B-4 guard permits only one approved database suite per process.",
  );
}

if (!stage2Enabled && !stage3Enabled) {
  // A normally skipped database suite must not inherit any ambient database URL.
  process.env.DATABASE_URL = disabledDatabaseUrl();
} else {
  const testUrl = process.env[TEST_URL_ENV];
  const metadataPath = process.env[METADATA_PATH_ENV];
  if (!testUrl || !metadataPath) {
    throw new Error(
      "Stage 3B-4 database tests require the verified local test URL and cluster metadata; refusing fallback.",
    );
  }

  const { apiRoot, runnerPath } = findRunner();
  const verificationEnv = {
    PATH: process.env.PATH || "",
    HOME: "/tmp",
    NODE_ENV: "test",
    [TEST_URL_ENV]: testUrl,
    [METADATA_PATH_ENV]: metadataPath,
  };
  const verification = spawnSync(
    process.execPath,
    [runnerPath, "--verify-isolation", "--metadata", metadataPath],
    {
      cwd: apiRoot,
      env: verificationEnv,
      stdio: "ignore",
      timeout: 15_000,
    },
  );

  if (verification.error || verification.status !== 0) {
    throw new Error(
      "Stage 3B-4 database identity verification failed before application database imports; refusing access.",
    );
  }

  // Only after the exact cluster and marker have been verified may db.ts load.
  process.env.DATABASE_URL = testUrl;
}
