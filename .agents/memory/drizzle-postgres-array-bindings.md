---
name: PostgreSQL ID array binding
description: Correct Drizzle parameter binding for PostgreSQL array operators.
---

For PostgreSQL `ANY` and `ALL`, bind a JavaScript ID array as one parameter and cast that parameter to the required array type. Direct interpolation of a JavaScript array into a Drizzle `sql` template expands its members into a row constructor, not a PostgreSQL array.

**Why:** The row-constructor form is not a valid `int[]` operand for `ANY` or `ALL`, so selection and exclusion predicates can fail despite appearing structurally correct in source.

**How to apply:** Use `sql.param(ids)` inside the SQL template, cast the bound value (for example, to `int[]`), and inspect generated SQL with the PostgreSQL dialect when adding or reviewing array predicates.
