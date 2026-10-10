-- Additive per-Student read receipts for teacher-to-student complaints.
-- This migration does not modify or backfill existing complaint records.
CREATE TABLE student_complaint_read_receipts (
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  session_id INTEGER NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
  complaint_id INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT student_complaint_read_receipts_pkey
    PRIMARY KEY (school_id, student_id, session_id, complaint_id)
);

CREATE INDEX student_complaint_read_receipts_complaint_idx
  ON student_complaint_read_receipts (complaint_id);
