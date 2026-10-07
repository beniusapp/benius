import assert from "node:assert/strict";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { dateOnlyInIST } from "./shared/ist-time";
import { studentWorkCreatedAtDateSql } from "./student-work-date";

const dialect = new PgDialect();
const createdAt = sql`"homework"."created_at"`;

test("Web work-date SQL converts the UTC timestamp to an IST calendar date", () => {
  const query = dialect.sqlToQuery(
    studentWorkCreatedAtDateSql(createdAt, "IST_BUSINESS_DATE"),
  );

  assert.match(query.sql, /AT TIME ZONE 'UTC' AT TIME ZONE 'Asia\/Kolkata'/);
  assert.match(query.sql, /::date$/);
});

test("default Mobile work-date SQL keeps its existing raw UTC date behavior", () => {
  const query = dialect.sqlToQuery(
    studentWorkCreatedAtDateSql(createdAt, "LEGACY_UTC_DATE"),
  );

  assert.doesNotMatch(query.sql, /AT TIME ZONE/);
  assert.match(query.sql, /::date$/);
});

test("IST date conversion handles the midnight boundary and reported timestamp", () => {
  assert.equal(dateOnlyInIST("2026-10-06T18:00:00.000Z"), "2026-10-06");
  assert.equal(dateOnlyInIST("2026-10-06T18:30:00.000Z"), "2026-10-07");
  assert.equal(dateOnlyInIST("2026-10-06T19:38:00.000Z"), "2026-10-07");
});
