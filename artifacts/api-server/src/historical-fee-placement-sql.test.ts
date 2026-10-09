import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import { HISTORICAL_PLACEMENT_UNAVAILABLE } from "./historical-fee-placement";
import {
  historicalFeePlacementJoin,
  historicalPlacementClassDisplay,
  historicalPlacementClassFilter,
  historicalPlacementSectionDisplay,
  historicalPlacementSectionFilter,
} from "./historical-fee-placement-sql";

const dialect = new PgDialect();

test("set-based placement join scopes exact tenant, Student and fee-record session", () => {
  const query = dialect.sqlToQuery(historicalFeePlacementJoin);
  const normalized = query.sql.replace(/\s+/g, " ");

  assert.match(normalized, /LEFT JOIN LATERAL/);
  assert.match(normalized, /e\.school_id = fr\.school_id/);
  assert.match(normalized, /e\.student_id = fr\.student_id/);
  assert.match(normalized, /e\.session_id = fr\.session_id/);
  assert.match(normalized, /COUNT\(\*\) = 1/);
  assert.match(normalized, /BOOL_AND/);
  assert.match(normalized, /BTRIM\(e\.class_name\) <> ''/);
  assert.match(normalized, /BTRIM\(e\.section_name\) <> ''/);
  assert.doesNotMatch(normalized, /GROUP BY/);
});

test("named filters use nullable historical placement and unresolved rows are display-only", () => {
  assert.equal(
    dialect.sqlToQuery(historicalPlacementClassFilter).sql,
    "historical_placement.class_name",
  );
  assert.equal(
    dialect.sqlToQuery(historicalPlacementSectionFilter).sql,
    "historical_placement.section_name",
  );
  assert.match(
    dialect.sqlToQuery(historicalPlacementClassDisplay).sql,
    /COALESCE\(historical_placement\.class_name, \$1\)/,
  );
  assert.equal(
    dialect.sqlToQuery(historicalPlacementClassDisplay).params[0],
    HISTORICAL_PLACEMENT_UNAVAILABLE,
  );
  assert.match(
    dialect.sqlToQuery(historicalPlacementSectionDisplay).sql,
    /COALESCE\(historical_placement\.section_name, '—'\)/,
  );
});
