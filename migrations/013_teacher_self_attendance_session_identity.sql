BEGIN;

ALTER TABLE teacher_self_attendance
  DROP CONSTRAINT IF EXISTS uq_teacher_self_attendance;

DROP INDEX IF EXISTS uq_teacher_self_attendance;

CREATE UNIQUE INDEX uq_teacher_self_attendance
  ON teacher_self_attendance (teacher_id, session_id, attendance_date);

COMMIT;