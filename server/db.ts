import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Timestamp columns that represent instants use the established UTC-naive
// storage convention. Pin each database connection to UTC so DEFAULT NOW()
// and all timestamp coercions remain independent of the Node host timezone.
pool.on("connect", (client) => {
  void client.query("SET TIME ZONE 'UTC'").catch((error) => {
    console.error("[db] failed to set connection timezone to UTC", error);
  });
});

export const db = drizzle(pool, { schema });
