import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { build } from "esbuild";
import {
  loadStage3B4Metadata,
  validateStage3B4TestUrl,
  verifyStage3B4LocalIdentity,
} from "./stage3b4-local-identity.mjs";

const { Client } = pg;
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(apiRoot, "../..");
const dbPackageRoot = path.join(workspaceRoot, "lib", "db");
const TEST_URL_ENV = "BENIUS_STAGE3B4_TEST_DATABASE_URL";
const METADATA_PATH_ENV = "BENIUS_STAGE3B4_TEST_METADATA_PATH";
const STAGE2_FLAG = "BENIUS_STAGE2B_DEV_DB_TEST";
const STAGE3_FLAG = "BENIUS_STAGE3_DEV_DB_TEST";

const APPROVED_BASE =
  "/tmp/benius-stage3b4.1e446f1c807e44c19b7aa7efb28a56f0";
const APPROVED_METADATA_PATH = path.join(APPROVED_BASE, "identity.json");
const APPROVED_IDENTITY = {
  baseDirectory: APPROVED_BASE,
  dataDirectory: path.join(APPROVED_BASE, "data"),
  socketDirectory: path.join(APPROVED_BASE, "socket"),
  port: 55432,
  databaseName: "benius_stage3b4_test",
  roleName: "benius_stage3b4_test",
  clusterId: "32455e68-5c64-47b7-a730-b2d5169da14c",
  markerKey: "e628dd40-4f83-4771-a315-fecc6268e0ba",
};

const approvedSuites = [
  {
    name: "Stage 2B promotion database suite",
    source: path.join(apiRoot, "src", "promotion-stage2-database.test.ts"),
    output: "promotion-stage2-database.test.cjs",
    flag: STAGE2_FLAG,
  },
  {
    name: "Stage 3 activation database suite",
    source: path.join(
      apiRoot,
      "src",
      "academic-session-activation-database.test.ts",
    ),
    output: "academic-session-activation-database.test.cjs",
    flag: STAGE3_FLAG,
  },
];

const fixtureSchoolNamePatterns = [
  "Stage 2B disposable %",
  "Stage 2B foreign %",
  "Stage 3 disposable %",
  "Stage 3 foreign %",
];
const fixtureScopedTables = [
  "academic_history",
  "academic_sessions",
  "audit_logs",
  "enrollments",
  "exam_policy_tiers",
  "exam_scores",
  "grading_rules",
  "grading_tiers",
  "non_teaching_staff",
  "promotion_decisions",
  "school_metadata",
  "students",
  "teachers",
  "users",
];

function fail(message) {
  throw new Error(message);
}

function assertApprovedMetadata(metadataPath) {
  if (metadataPath !== APPROVED_METADATA_PATH) {
    fail("Refusing a metadata path other than the exact Phase B1 cluster.");
  }
  const metadata = loadStage3B4Metadata(metadataPath);
  for (const [key, expected] of Object.entries(APPROVED_IDENTITY)) {
    if (metadata[key] !== expected) {
      fail("Phase B1 metadata does not match the approved cluster identity.");
    }
  }
  return metadata;
}

function readTestContext(metadataPath) {
  const metadata = assertApprovedMetadata(metadataPath);
  const testUrl = process.env[TEST_URL_ENV];
  const connection = validateStage3B4TestUrl(testUrl, metadata);
  return { metadata, metadataPath, testUrl, connection };
}

async function verifyIdentity(context) {
  return verifyStage3B4LocalIdentity({
    env: { [TEST_URL_ENV]: context.testUrl },
    metadataPath: context.metadataPath,
  });
}

function createClient(context, applicationName) {
  return new Client({
    ...context.connection,
    connectionTimeoutMillis: 3_000,
    query_timeout: 10_000,
    application_name: applicationName,
  });
}

async function withClient(context, applicationName, callback) {
  const client = createClient(context, applicationName);
  try {
    await client.connect();
    return await callback(client);
  } finally {
    await client.end().catch(() => {});
  }
}

async function inspectDatabase(context) {
  return withClient(context, "benius-stage3b4-schema-inspection", async (client) => {
    const schemas = await client.query(`
      SELECT nspname
      FROM pg_catalog.pg_namespace
      WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'public', 'stage3b4_meta')
        AND nspname NOT LIKE 'pg_toast%'
        AND nspname NOT LIKE 'pg_temp_%'
      ORDER BY nspname
    `);
    const publicRelations = await client.query(`
      SELECT c.relname, c.relkind
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      ORDER BY c.relname
    `);
    const publicEnums = await client.query(`
      SELECT t.typname
      FROM pg_catalog.pg_type AS t
      JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typtype = 'e'
      ORDER BY t.typname
    `);
    const markerRelations = await client.query(`
      SELECT c.relname, c.relkind
      FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'stage3b4_meta'
        AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
      ORDER BY c.relname
    `);
    return {
      unexpectedSchemas: schemas.rows.map((row) => row.nspname),
      publicRelations: publicRelations.rows,
      publicEnums: publicEnums.rows.map((row) => row.typname),
      markerRelations: markerRelations.rows,
    };
  });
}

function assertOnlyPhaseB1Marker(inventory) {
  if (
    inventory.unexpectedSchemas.length !== 0 ||
    inventory.publicRelations.length !== 0 ||
    inventory.publicEnums.length !== 0 ||
    inventory.markerRelations.length !== 1 ||
    inventory.markerRelations[0]?.relname !== "cluster_identity" ||
    !["r", "p"].includes(inventory.markerRelations[0]?.relkind)
  ) {
    fail(
      "The test database is not an empty Phase B1 target; no schema changes were applied.",
    );
  }
}

function splitExportedSql(sql) {
  const chunks = sql.split(/(?=^(?:CREATE|ALTER)\s)/gm);
  const statements = chunks
    .map((chunk) =>
      chunk
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*--.*$/gm, "")
        .trim(),
    )
    .filter(Boolean);

  if (statements.length === 0) {
    fail("The generated schema SQL contains no statements.");
  }

  for (const statement of statements) {
    if (
      /\b(DROP|TRUNCATE|GRANT|REVOKE)\b/i.test(statement) ||
      /^\s*(INSERT|UPDATE|DELETE)\b/i.test(statement)
    ) {
      fail("The generated schema SQL contains a prohibited destructive or data statement.");
    }
    const createOnly =
      /^CREATE\s+(?:TYPE|TABLE|SEQUENCE|INDEX|SCHEMA)\b/i.test(statement) ||
      /^CREATE\s+UNIQUE\s+INDEX\b/i.test(statement);
    const addConstraintOnly =
      /^ALTER\s+TABLE\b[\s\S]*\bADD\s+CONSTRAINT\b/i.test(statement);
    if (!createOnly && !addConstraintOnly) {
      fail("The generated schema SQL contains an unapproved statement; refusing initialization.");
    }
  }

  return statements;
}

async function readApprovedSchemaSql(sqlPath) {
  const expectedPath = path.join(APPROVED_BASE, "schema-init.sql");
  if (sqlPath !== expectedPath) {
    fail("Refusing a schema SQL file outside the approved Phase B1 directory.");
  }
  const info = await lstat(sqlPath).catch(() => undefined);
  if (!info?.isFile() || info.isSymbolicLink()) {
    fail("The reviewed schema SQL must be a regular file, not a symlink.");
  }
  if ((await realpath(sqlPath)) !== expectedPath) {
    fail("The schema SQL path did not resolve to the approved file.");
  }
  return splitExportedSql(await readFile(sqlPath, "utf8"));
}

async function initializeSchema(context, sqlPath) {
  const beforeIdentity = await verifyIdentity(context);
  assert.equal(beforeIdentity.unixSocketOnly, true);
  const before = await inspectDatabase(context);
  assertOnlyPhaseB1Marker(before);
  const statements = await readApprovedSchemaSql(sqlPath);

  await withClient(context, "benius-stage3b4-schema-initializer", async (client) => {
    await client.query("BEGIN");
    try {
      for (const statement of statements) {
        await client.query(statement);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  });

  const afterIdentity = await verifyIdentity(context);
  const after = await inspectDatabase(context);
  if (
    afterIdentity.markerVerified !== true ||
    after.publicRelations.length === 0 ||
    after.unexpectedSchemas.length !== 0
  ) {
    fail("Schema initialization did not preserve the marker or produced an unexpected schema.");
  }

  console.log(
    `PASS: applied ${statements.length} reviewed create-only statements to the verified isolated database; ${after.publicRelations.length} public relations now exist.`,
  );
}

function safeChildEnvironment(context, suiteFlag) {
  const environment = {
    PATH: process.env.PATH || "",
    HOME: "/tmp",
    NODE_ENV: "test",
    TZ: "UTC",
    [TEST_URL_ENV]: context.testUrl,
    [METADATA_PATH_ENV]: context.metadataPath,
  };
  if (suiteFlag) environment[suiteFlag] = "1";
  if (suiteFlag) {
    // The only general database URL passed to an application test is this
    // already-validated Phase B1 URL.
    environment.DATABASE_URL = context.testUrl;
  }
  return environment;
}

function scrubOutput(value, context) {
  let result = String(value || "");
  for (const secret of [
    context.testUrl,
    context.connection.password,
    encodeURIComponent(context.connection.password),
  ]) {
    if (secret) result = result.split(secret).join("[REDACTED]");
  }
  return result;
}

async function buildSuite(suite, cacheDirectory) {
  const outfile = path.join(cacheDirectory, suite.output);
  await build({
    entryPoints: [suite.source],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    sourcemap: false,
    external: ["sharp"],
    logLevel: "silent",
  });
  return outfile;
}

function parseTapSummary(output) {
  const match = (key) =>
    Number(output.match(new RegExp(`^# ${key} (\\d+)$`, "m"))?.[1]);
  return {
    tests: match("tests"),
    passed: match("pass"),
    failed: match("fail"),
    skipped: match("skipped"),
  };
}

async function runSuite(context, suite, cacheDirectory) {
  await verifyIdentity(context);
  const bundlePath = await buildSuite(suite, cacheDirectory);
  const result = spawnSync(process.execPath, ["--test", bundlePath], {
    cwd: apiRoot,
    env: safeChildEnvironment(context, suite.flag),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
  });

  const output = scrubOutput(
    `${result.stdout || ""}${result.stderr || ""}`,
    context,
  );
  if (output.trim()) process.stdout.write(output);

  const summary = parseTapSummary(output);
  const passed =
    result.status === 0 &&
    summary.tests === 1 &&
    summary.passed === 1 &&
    summary.failed === 0 &&
    summary.skipped === 0;
  console.log(
    `${passed ? "PASS" : "FAIL"}: ${suite.name} — tests=${summary.tests}, passed=${summary.passed}, failed=${summary.failed}, skipped=${summary.skipped}.`,
  );
  return { passed, summary, status: result.status, error: result.error };
}

async function inspectPostTestIntegrity(context) {
  const identity = await verifyIdentity(context);
  const inventory = await inspectDatabase(context);
  const result = await withClient(
    context,
    "benius-stage3b4-post-test-integrity",
    async (client) => {
      const fixtureSchools = await client.query(
        `SELECT id, name
         FROM schools
         WHERE name LIKE $1 OR name LIKE $2 OR name LIKE $3 OR name LIKE $4
         ORDER BY id`,
        fixtureSchoolNamePatterns,
      );
      const schoolIds = fixtureSchools.rows.map((row) => Number(row.id));
      const tableCounts = {};
      for (const table of fixtureScopedTables) {
        const column = await client.query(
          `SELECT 1
           FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'school_id'`,
          [table],
        );
        if (column.rowCount === 0) {
          fail(`Post-test integrity check cannot find the expected school_id column in ${table}.`);
        }
        const count = await client.query(
          `SELECT COUNT(*)::int AS count FROM "${table}" WHERE school_id = ANY($1::int[])`,
          [schoolIds],
        );
        tableCounts[table] = Number(count.rows[0]?.count || 0);
      }
      const stage2AuditRows = await client.query(
        `SELECT COUNT(*)::int AS count FROM audit_logs
         WHERE details ILIKE '%Stage 2B%'`,
      );
      const stage2DecisionRows = await client.query(
        `SELECT COUNT(*)::int AS count FROM promotion_decisions
         WHERE term LIKE 'Stage 2B %'`,
      );
      const stage3Sessions = await client.query(
        `SELECT COUNT(*)::int AS count FROM academic_sessions
         WHERE session_name LIKE 'Stage 3 %'`,
      );
      const leftoverTriggers = await client.query(`
        SELECT COUNT(*)::int AS count
        FROM pg_catalog.pg_trigger AS t
        JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND t.tgname LIKE 'stage3_activation_failure_%'
          AND NOT t.tgisinternal
      `);
      const leftoverFunctions = await client.query(`
        SELECT COUNT(*)::int AS count
        FROM pg_catalog.pg_proc AS p
        JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname LIKE 'stage3_activation_failure_%'
      `);
      return {
        fixtureSchools: fixtureSchools.rows,
        tableCounts,
        stage2AuditRows: Number(stage2AuditRows.rows[0]?.count || 0),
        stage2DecisionRows: Number(stage2DecisionRows.rows[0]?.count || 0),
        stage3Sessions: Number(stage3Sessions.rows[0]?.count || 0),
        leftoverTriggers: Number(leftoverTriggers.rows[0]?.count || 0),
        leftoverFunctions: Number(leftoverFunctions.rows[0]?.count || 0),
      };
    },
  );

  const nonzeroTableCounts = Object.entries(result.tableCounts)
    .filter(([, count]) => count !== 0);
  const clean =
    identity.markerVerified === true &&
    inventory.markerRelations.length === 1 &&
    result.fixtureSchools.length === 0 &&
    nonzeroTableCounts.length === 0 &&
    result.stage2AuditRows === 0 &&
    result.stage2DecisionRows === 0 &&
    result.stage3Sessions === 0 &&
    result.leftoverTriggers === 0 &&
    result.leftoverFunctions === 0;

  console.log(
    JSON.stringify(
      {
        postTestIntegrity: clean ? "PASS" : "NEEDS REVIEW",
        identity: {
          databaseName: identity.databaseName,
          roleName: identity.roleName,
          clusterId: identity.clusterId,
          unixSocketOnly: identity.unixSocketOnly,
          markerVerified: identity.markerVerified,
        },
        schema: {
          publicRelations: inventory.publicRelations.length,
          unexpectedSchemas: inventory.unexpectedSchemas,
        },
        fixtureSchools: result.fixtureSchools,
        nonzeroFixtureTableCounts: Object.fromEntries(nonzeroTableCounts),
        stage2AuditRows: result.stage2AuditRows,
        stage2DecisionRows: result.stage2DecisionRows,
        stage3Sessions: result.stage3Sessions,
        leftoverTriggers: result.leftoverTriggers,
        leftoverFunctions: result.leftoverFunctions,
      },
      null,
      2,
    ),
  );
  return clean;
}

async function runApprovedSuites(context) {
  const identity = await verifyIdentity(context);
  assert.equal(identity.markerVerified, true);
  const inventory = await inspectDatabase(context);
  if (inventory.publicRelations.length === 0) {
    fail("The isolated test database has no application schema; refusing to run tests.");
  }

  const cacheDirectory = path.join(
    apiRoot,
    "node_modules",
    ".cache",
    "stage3b4-phase-b2",
  );
  await mkdir(cacheDirectory, { recursive: true });

  let testFailure = false;
  for (const suite of approvedSuites) {
    const result = await runSuite(context, suite, cacheDirectory);
    if (!result.passed) {
      testFailure = true;
      console.error(
        `STOP: ${suite.name} did not pass; no later approved suite will run.`,
      );
      break;
    }
  }

  let integrityClean = false;
  try {
    integrityClean = await inspectPostTestIntegrity(context);
  } catch (error) {
    console.error(
      `Post-test integrity check failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  if (testFailure || !integrityClean) {
    process.exitCode = 2;
    return;
  }

  console.log("PASS: only the two approved database suites ran, sequentially.");
}

function parseMetadataActionArgs(action, args) {
  const metadataIndex = args.indexOf("--metadata");
  const metadataPath =
    metadataIndex >= 0 ? args[metadataIndex + 1] : undefined;
  if (!metadataPath || metadataIndex !== 0) {
    fail(`Usage: ${action} --metadata ${APPROVED_METADATA_PATH}`);
  }
  return metadataPath;
}

async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (action === "--verify-isolation") {
    const metadataPath = parseMetadataActionArgs(action, args);
    const context = readTestContext(metadataPath);
    const identity = await verifyIdentity(context);
    console.log(
      JSON.stringify(
        {
          isolation: "PASS",
          databaseName: identity.databaseName,
          roleName: identity.roleName,
          clusterId: identity.clusterId,
          socketDirectory: identity.socketDirectory,
          port: identity.port,
          unixSocketOnly: identity.unixSocketOnly,
          markerVerified: identity.markerVerified,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (action === "--initialize-schema") {
    if (args.length !== 4 || args[2] !== "--sql") {
      fail(
        `Usage: ${action} --metadata ${APPROVED_METADATA_PATH} --sql ${path.join(APPROVED_BASE, "schema-init.sql")}`,
      );
    }
    const metadataPath = parseMetadataActionArgs(action, args.slice(0, 2));
    const sqlPath = args[3];
    const context = readTestContext(metadataPath);
    await initializeSchema(context, sqlPath);
    return;
  }

  if (action === "--run-approved-suites") {
    if (args.length !== 2) {
      fail(`Usage: ${action} --metadata ${APPROVED_METADATA_PATH}`);
    }
    const metadataPath = parseMetadataActionArgs(action, args);
    const context = readTestContext(metadataPath);
    await runApprovedSuites(context);
    return;
  }

  fail(
    "REFUSED: only exact Phase B1 isolation verification, create-only schema initialization, and the two approved sequential database suites are supported.",
  );
}

main().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : "Stage 3B-4 Phase B2 runner refused.",
  );
  process.exitCode = 2;
});
