-- Forward-only Student Complaint reply notifications.
-- Deliberately does not alter or backfill existing receipt or complaint rows.
CREATE TABLE student_complaint_notification_events (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  session_id INTEGER NOT NULL REFERENCES academic_sessions(id) ON DELETE CASCADE,
  complaint_id INTEGER NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  note_id INTEGER REFERENCES complaint_notes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ
);

CREATE INDEX student_complaint_notification_events_scope_idx
  ON student_complaint_notification_events
    (school_id, student_id, session_id, complaint_id, read_at);

CREATE INDEX student_complaint_notification_events_note_idx
  ON student_complaint_notification_events (note_id);
