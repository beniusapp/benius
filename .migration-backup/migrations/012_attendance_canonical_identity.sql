BEGIN;

ALTER TABLE attendance_records
  DROP CONSTRAINT IF EXISTS attendance_records_session_id_fkey;

ALTER TABLE attendance_records
  ALTER COLUMN session_id SET NOT NULL;

ALTER TABLE attendance_records
  ADD CONSTRAINT attendance_records_session_id_fkey
  FOREIGN KEY (session_id)
  REFERENCES academic_sessions(id)
  ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS attendance_records_canonical_identity_uidx
  ON attendance_records (school_id, session_id, student_id, date);

COMMIT;