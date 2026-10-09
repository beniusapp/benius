import { sql } from "drizzle-orm";
import { HISTORICAL_PLACEMENT_UNAVAILABLE } from "./historical-fee-placement";

/**
 * One aggregate row per fee record, resolved only by its exact
 * school/student/session tuple. Aggregation prevents enrollment joins from
 * multiplying financial rows and makes duplicate/incomplete matches fail
 * closed.
 *
 * Callers must use fee_records with the alias `fr`.
 */
export const historicalFeePlacementJoin = sql`
  LEFT JOIN LATERAL (
    SELECT
      CASE
        WHEN COUNT(*) = 1
          AND BOOL_AND(
            e.class_name IS NOT NULL
            AND BTRIM(e.class_name) <> ''
            AND e.section_name IS NOT NULL
            AND BTRIM(e.section_name) <> ''
          )
        THEN MAX(e.class_name)
        ELSE NULL
      END AS class_name,
      CASE
        WHEN COUNT(*) = 1
          AND BOOL_AND(
            e.class_name IS NOT NULL
            AND BTRIM(e.class_name) <> ''
            AND e.section_name IS NOT NULL
            AND BTRIM(e.section_name) <> ''
          )
        THEN MAX(e.section_name)
        ELSE NULL
      END AS section_name
    FROM enrollments e
    WHERE e.school_id = fr.school_id
      AND e.student_id = fr.student_id
      AND e.session_id = fr.session_id
  ) historical_placement ON true
`;

export const historicalPlacementClassFilter = sql`historical_placement.class_name`;
export const historicalPlacementSectionFilter = sql`historical_placement.section_name`;

export const historicalPlacementClassDisplay = sql`
  COALESCE(historical_placement.class_name, ${HISTORICAL_PLACEMENT_UNAVAILABLE})
`;
export const historicalPlacementSectionDisplay = sql`
  COALESCE(historical_placement.section_name, '—')
`;
