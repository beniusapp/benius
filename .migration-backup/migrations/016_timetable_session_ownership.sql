BEGIN;

-- Old global structure data has no reliable Academic Session owner. Reset it
-- explicitly in a development database before applying this migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM timetable_entries WHERE session_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Assign or remove NULL-session timetable entries before migrating';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'timetable_structure' AND column_name = 'session_id'
  ) AND EXISTS (SELECT 1 FROM timetable_structure) THEN
    RAISE EXCEPTION 'Reset old global timetable_structure rows explicitly before migrating';
  END IF;
END
$$;

ALTER TABLE timetable_entries
  ALTER COLUMN session_id SET NOT NULL;
ALTER TABLE timetable_entries
  DROP CONSTRAINT IF EXISTS timetable_entries_session_id_fkey;
ALTER TABLE timetable_entries
  ADD CONSTRAINT timetable_entries_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES academic_sessions(id) ON DELETE CASCADE;
DROP INDEX IF EXISTS timetable_class_slot_unique;
CREATE UNIQUE INDEX timetable_class_slot_unique
  ON timetable_entries (school_id, session_id, class, section, day_of_week, period);

ALTER TABLE timetable_structure
  ADD COLUMN IF NOT EXISTS session_id INTEGER;
ALTER TABLE timetable_structure
  ALTER COLUMN session_id SET NOT NULL;
ALTER TABLE timetable_structure
  DROP CONSTRAINT IF EXISTS timetable_structure_session_id_fkey;
ALTER TABLE timetable_structure
  ADD CONSTRAINT timetable_structure_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES academic_sessions(id) ON DELETE CASCADE;
DROP INDEX IF EXISTS timetable_structure_period_unique;
CREATE UNIQUE INDEX timetable_structure_period_unique
  ON timetable_structure (school_id, session_id, class, period_number)
  WHERE NOT is_break;

COMMIT;