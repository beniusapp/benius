import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

export type StudentWorkDateMode = "LEGACY_UTC_DATE" | "IST_BUSINESS_DATE";

export function studentWorkCreatedAtDateSql(
  createdAt: SQLWrapper,
  mode: StudentWorkDateMode,
): SQL {
  if (mode === "IST_BUSINESS_DATE") {
    return sql`(${createdAt} AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date`;
  }

  return sql`${createdAt}::date`;
}
