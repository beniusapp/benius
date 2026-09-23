import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { pool } from "../db";

const migration014 = readFileSync(
  new URL("../../migrations/014_attendance_student_preservation.sql", import.meta.url),
  "utf8",
).replace(/^\s*BEGIN;\s*/i, "").replace(/\s*COMMIT;\s*$/i, "");

let client: Awaited<ReturnType<typeof pool.connect>> | undefined;
let schemaName = "";

function identifier(name: string) {
  return `"${name.replaceAll(`"`, `""`)}"`;
}

async function beginIsolatedFixture(withIdentityColumns = false) {
  client = await pool.connect();
  schemaName = `attendance_identity_test_${randomUUID().replaceAll("-", "")}`;
  await client.query("BEGIN");
  await client.query(`CREATE SCHEMA ${identifier(schemaName)}`);
  await client.query(`SET LOCAL search_path = ${identifier(schemaName)}, public`);
  await client.query(`
    CREATE TABLE students (
      id INTEGER PRIMARY KEY,
      school_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      digital_student_id VARCHAR(50) NOT NULL
      ${withIdentityColumns ? ", attendance_identity_key UUID" : ""}
    );
    CREATE TABLE attendance_records (
      id INTEGER PRIMARY KEY,
      student_id INTEGER,
      school_id INTEGER NOT NULL,
      session_id INTEGER NOT NULL,
      date DATE NOT NULL
      ${withIdentityColumns ? `,
      original_student_id INTEGER,
      identity_key UUID,
      student_name_snapshot TEXT,
      student_code_snapshot VARCHAR(50)` : ""}
    );
  `);
}

afterEach(async () => {
  if (!client) return;
  await client.query("ROLLBACK");
  client.release();
  client = undefined;
  schemaName = "";
});

describe("isolated migration 014 attendance identity validation", () => {
  it("backfills a valid legacy record and preserves its data", async () => {
    await beginIsolatedFixture();
    await client!.query(`
      INSERT INTO students (id, school_id, name, digital_student_id)
      VALUES (1, 10, 'Legacy Student', 'LEG-1');
      INSERT INTO attendance_records (id, student_id, school_id, session_id, date)
      VALUES (1, 1, 10, 20, '2040-01-01');
    `);

    await client!.query(migration014);

    const result = await client!.query(`
      SELECT ar.original_student_id, ar.identity_key, ar.student_name_snapshot,
             ar.student_code_snapshot, s.attendance_identity_key
      FROM attendance_records ar
      JOIN students s ON s.id = ar.student_id
    `);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      original_student_id: 1,
      student_name_snapshot: "Legacy Student",
      student_code_snapshot: "LEG-1",
    });
    expect(result.rows[0].identity_key).toBe(result.rows[0].attendance_identity_key);
    expect((await client!.query("SELECT count(*)::int AS count FROM attendance_records")).rows[0].count)
      .toBe(1);
  });

  it.each([
    {
      name: "partially populated historical identity",
      record: `(1, 1, 10, 20, '2040-01-01', 1, NULL, 'Legacy Student', 'LEG-1')`,
    },
    {
      name: "contradictory live student identity",
      record: `(1, 1, 10, 20, '2040-01-01', 99, '00000000-0000-0000-0000-000000000099', 'Legacy Student', 'LEG-1')`,
    },
    {
      name: "missing live student association",
      record: `(1, 999, 10, 20, '2040-01-01', 999, '00000000-0000-0000-0000-000000000099', 'Legacy Student', 'LEG-1')`,
    },
    {
      name: "duplicate canonical attendance row",
      record: `(1, 1, 10, 20, '2040-01-01', 1, '00000000-0000-0000-0000-000000000001', 'Legacy Student', 'LEG-1'),
               (2, 1, 10, 20, '2040-01-01', 1, '00000000-0000-0000-0000-000000000001', 'Legacy Student', 'LEG-1')`,
    },
  ])("rejects $name and rolls back the isolated fixture", async ({ record }) => {
    await beginIsolatedFixture(true);
    await client!.query(`
      INSERT INTO students (id, school_id, name, digital_student_id, attendance_identity_key)
      VALUES (1, 10, 'Legacy Student', 'LEG-1', '00000000-0000-0000-0000-000000000001');
      INSERT INTO attendance_records
        (id, student_id, school_id, session_id, date, original_student_id,
         identity_key, student_name_snapshot, student_code_snapshot)
      VALUES ${record};
    `);

    await expect(client!.query(migration014)).rejects.toThrow();
    await client!.query("ROLLBACK");
    const schemaCheck = await client!.query(
      "SELECT 1 FROM pg_namespace WHERE nspname = $1",
      [schemaName],
    );
    expect(schemaCheck.rows).toHaveLength(0);
    client!.release();
    client = undefined;
    schemaName = "";
  });
});