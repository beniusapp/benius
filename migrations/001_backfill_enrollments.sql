-- =============================================================================
-- BENIUS · One-Time Backfill Migration
-- Script   : 001_backfill_enrollments.sql
-- Purpose  : Enroll all existing students (created before Academic Sessions
--            were introduced) into the currently active academic session.
-- Safety   : Runs inside a single transaction — rolls back on any error.
--            Uses INSERT … ON CONFLICT DO NOTHING — fully idempotent.
--            Zero DELETEs, zero UPDATEs to student/profile data.
-- Pre-run  : Verify the active session looks correct in the audit block below.
-- Post-run : Verify counts match in the verification block at the end.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 0 · PRE-FLIGHT AUDIT  (read-only — safe to inspect before committing)
-- ─────────────────────────────────────────────────────────────────────────────

-- Show what will be treated as the active session for this school
SELECT
  id            AS session_id,
  school_id,
  session_name,
  start_date,
  end_date,
  is_active,
  created_at
FROM academic_sessions
WHERE is_active = true
ORDER BY school_id;

-- Show how many students are NOT yet enrolled in the active session (the gap)
SELECT
  s.school_id,
  COUNT(*)  AS students_to_enroll
FROM students s
JOIN academic_sessions a
  ON a.school_id = s.school_id
 AND a.is_active = true
WHERE NOT EXISTS (
  SELECT 1
  FROM enrollments e
  WHERE e.student_id = s.id
    AND e.session_id  = a.id
)
GROUP BY s.school_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1 · BACKFILL ENROLLMENTS
-- For every student that has no enrollment record in their school's active
-- session, insert one using the student's current class / section / roll_number.
-- ON CONFLICT DO NOTHING means this is safe to re-run at any time.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO enrollments (school_id, student_id, session_id, class_name, section_name, roll_no, status)
SELECT
  s.school_id,
  s.id                         AS student_id,
  a.id                         AS session_id,
  s.class                      AS class_name,
  s.section                    AS section_name,
  s.roll_number                AS roll_no,
  CASE
    WHEN s.is_active = true  THEN 'Active'
    ELSE 'Inactive'
  END                          AS status
FROM students s
JOIN academic_sessions a
  ON a.school_id = s.school_id
 AND a.is_active = true
WHERE NOT EXISTS (
  SELECT 1
  FROM enrollments e
  WHERE e.student_id = s.id
    AND e.session_id  = a.id
)
ON CONFLICT (school_id, student_id, session_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2 · POST-RUN VERIFICATION
-- These counts should show: gap = 0, and enrolled = total_students.
-- If anything looks wrong, run ROLLBACK; before proceeding.
-- ─────────────────────────────────────────────────────────────────────────────

SELECT
  s.school_id,
  COUNT(DISTINCT s.id)                                               AS total_students,
  COUNT(DISTINCT e.student_id)                                       AS enrolled_in_active_session,
  COUNT(DISTINCT s.id) - COUNT(DISTINCT e.student_id)               AS remaining_gap
FROM students s
JOIN academic_sessions a
  ON a.school_id = s.school_id
 AND a.is_active = true
LEFT JOIN enrollments e
  ON e.student_id = s.id
 AND e.session_id  = a.id
GROUP BY s.school_id;

-- ─────────────────────────────────────────────────────────────────────────────
-- If the verification above shows remaining_gap = 0 for all schools → COMMIT.
-- Otherwise run ROLLBACK; and investigate before re-running.
-- ─────────────────────────────────────────────────────────────────────────────

COMMIT;

-- =============================================================================
-- RECOVERY NOTE
-- This script is non-destructive:
--   • No rows were deleted from any table.
--   • No existing profile, attendance, homework, or exam data was modified.
--   • The unique index on (school_id, student_id, session_id) prevents
--     duplicates even if the script is accidentally run a second time.
--   • To undo: DELETE FROM enrollments WHERE session_id = <active_session_id>
--     AND created_at >= '<timestamp of migration run>';
-- =============================================================================
