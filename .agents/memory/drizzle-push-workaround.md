---
name: Drizzle Push Interactive Prompt Workaround
description: drizzle-kit push hangs on table-creation confirmation; workaround is direct SQL via pg Pool.
---

## The Rule
`npx drizzle-kit push` blocks on an interactive prompt ("Is X table created or renamed from another table?") and cannot be piped through in this environment.

**Why:** The drizzle-kit CLI uses an interactive TTY prompt for new table confirmation that `printf '\n'` and `echo` pipes do not satisfy.

## How to Apply
When adding a new Drizzle table and needing to push schema, run a direct SQL CREATE TABLE via Node:
```js
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(`CREATE TABLE IF NOT EXISTS my_table (...)`).then(() => { pool.end(); });
```
This bypasses the interactive prompt entirely. The IF NOT EXISTS guard makes it safe to re-run.
