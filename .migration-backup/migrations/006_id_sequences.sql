-- =============================================================================
-- Migration 006: Track monotonic DSID/DTID counters
-- Purpose : Make the allocator's counter table reproducible on every database.
-- Safety  : Idempotent. Existing counters are only moved forward.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS id_sequences (
  school_id    INTEGER NOT NULL,
  type         TEXT    NOT NULL,
  last_issued  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (school_id, type)
);

-- Seed both counter types for every school. The source IDs are historical
-- identifiers, so inactive students and removed teachers are included too.
WITH teacher_ids AS (
  SELECT school_id, digital_teacher_id
  FROM teachers
  UNION ALL
  SELECT school_id, digital_teacher_id
  FROM removed_teachers_log
),
counters AS (
  SELECT
    s.id AS school_id,
    'dtid'::TEXT AS type,
    COALESCE(MAX(
      CASE
        WHEN LEFT(t.digital_teacher_id, LENGTH(s.code) + 2) = s.code || '-T'
         AND SUBSTRING(t.digital_teacher_id FROM LENGTH(s.code) + 3) ~ '^[0-9]+$'
        THEN SUBSTRING(t.digital_teacher_id FROM LENGTH(s.code) + 3)::INTEGER
        ELSE 0
      END
    ), 0)::INTEGER AS last_issued
  FROM schools s
  LEFT JOIN teacher_ids t ON t.school_id = s.id
  GROUP BY s.id, s.code

  UNION ALL

  SELECT
    s.id AS school_id,
    'dsid'::TEXT AS type,
    COALESCE(MAX(
      CASE
        WHEN LEFT(st.digital_student_id, LENGTH(s.code) + 1) = s.code || '-'
         AND SUBSTRING(st.digital_student_id FROM LENGTH(s.code) + 2) ~ '^[0-9]+$'
        THEN SUBSTRING(st.digital_student_id FROM LENGTH(s.code) + 2)::INTEGER
        ELSE 0
      END
    ), 0)::INTEGER AS last_issued
  FROM schools s
  LEFT JOIN students st ON st.school_id = s.id
  GROUP BY s.id, s.code
)
INSERT INTO id_sequences (school_id, type, last_issued)
SELECT school_id, type, last_issued
FROM counters
ON CONFLICT (school_id, type) DO UPDATE
SET last_issued = GREATEST(id_sequences.last_issued, EXCLUDED.last_issued);

COMMIT;