/**
 * schema-validator.ts
 *
 * Startup-time guard: compares every column defined in shared/schema.ts against
 * the actual PostgreSQL database and exits with a non-zero code if anything is
 * missing.
 *
 * WHY THIS EXISTS
 * ───────────────
 * New columns are sometimes added to the Drizzle schema and the dev database via
 * a direct `node -e` SQL snippet.  When that shortcut is used the matching
 * `ALTER TABLE … ADD COLUMN IF NOT EXISTS` statement is never added to the
 * startup migration block in server/index.ts, so production stays behind.
 *
 * This validator makes that gap visible at deploy time instead of at runtime,
 * turning a silent Razorpay 500 into a loud start-up failure that blocks the
 * deployment health check and keeps the old revision in service.
 *
 * HOW IT WORKS
 * ────────────
 * 1. Import every pgTable exported from shared/schema.ts.
 * 2. Use Drizzle's getTableName() + getTableColumns() to build a flat list of
 *    expected { table, column } pairs.
 * 3. Query information_schema.columns for all tables in the public schema.
 * 4. Find the diff: columns that Drizzle expects but the DB does not have.
 * 5. If any are missing → log each one with a [SCHEMA DRIFT] prefix so they are
 *    easy to grep, then process.exit(1).
 *
 * The check is idempotent and read-only — it never modifies the database.
 */

import { getTableName, getTableColumns } from "drizzle-orm";
import type { Pool } from "pg";

// ── Import every table exported from the shared schema ────────────────────────
// New tables added to schema.ts are picked up automatically; no manual update
// needed here.
import * as schema from "../shared/schema";

/** One expected column entry derived from the Drizzle schema. */
interface ExpectedColumn {
  table: string;
  column: string;
}

/**
 * Build a flat list of { table, column } from every pgTable in shared/schema.ts.
 *
 * Drizzle table objects carry their DB name in getTableName() and expose their
 * column definitions via getTableColumns(), where each value has a `.name`
 * property holding the actual DB column name (snake_case).
 */
function buildExpectedColumns(): ExpectedColumn[] {
  const expected: ExpectedColumn[] = [];

  for (const exportValue of Object.values(schema)) {
    // Skip non-table exports (types, insert schemas, plain objects, etc.)
    // A Drizzle pgTable result is an object — we can probe it with getTableName.
    try {
      // getTableName throws (or returns undefined) on non-table values
      const tableName = getTableName(exportValue as any);
      if (!tableName) continue;

      const columns = getTableColumns(exportValue as any);
      for (const col of Object.values(columns)) {
        expected.push({ table: tableName, column: (col as any).name });
      }
    } catch {
      // Not a table — skip
    }
  }

  return expected;
}

/**
 * Fetch all column names that actually exist in the public schema of the DB,
 * keyed as "table_name.column_name" for fast lookup.
 */
async function fetchActualColumns(pool: Pool): Promise<Set<string>> {
  const result = await pool.query<{ table_name: string; column_name: string }>(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `);

  return new Set(result.rows.map((r) => `${r.table_name}.${r.column_name}`));
}

/**
 * Run the schema drift check.
 *
 * @param pool  A pg Pool that is already connected to the target database.
 * @returns     The list of missing columns, or an empty array when all match.
 *
 * The caller decides how to handle the result.  server/index.ts treats any
 * non-empty list as a fatal error and exits with code 1.
 */
export async function validateSchemaColumns(
  pool: Pool,
): Promise<ExpectedColumn[]> {
  const expected = buildExpectedColumns();
  const actual = await fetchActualColumns(pool);

  const missing = expected.filter(
    ({ table, column }) => !actual.has(`${table}.${column}`),
  );

  return missing;
}

/**
 * Run the check and exit the process if any columns are missing.
 *
 * Call this from server/index.ts right after the startup migration block and
 * before registerRoutes() so that:
 *  - Migrations are applied first (closing the gap if the ALTER TABLE is
 *    already present in the migration block).
 *  - If any column is STILL missing after migrations, the server refuses to
 *    start, blocking the deployment health check so Razorpay (or any caller)
 *    keeps retrying against the old healthy revision.
 */
export async function assertNoSchemaDrift(pool: Pool): Promise<void> {
  const missing = await validateSchemaColumns(pool);

  if (missing.length === 0) {
    console.log("[schema-validator] ✓ All schema columns present in DB.");
    return;
  }

  // Log each missing column with a grepping-friendly prefix.
  console.error(
    `[SCHEMA DRIFT] ${missing.length} column(s) defined in shared/schema.ts ` +
      `are missing from the database.  Add each one to the startup migration ` +
      `block in server/index.ts as an ALTER TABLE … ADD COLUMN IF NOT EXISTS ` +
      `statement, then redeploy.`,
  );
  for (const { table, column } of missing) {
    console.error(`[SCHEMA DRIFT]   MISSING: ${table}.${column}`);
  }
  console.error(
    "[SCHEMA DRIFT] Server will not start until all columns are present.",
  );

  process.exit(1);
}
