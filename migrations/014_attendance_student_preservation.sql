BEGIN;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS attendance_identity_key UUID;

UPDATE students
SET attendance_identity_key = gen_random_uuid()
WHERE attendance_identity_key IS NULL;

ALTER TABLE students
  ALTER COLUMN attendance_identity_key SET DEFAULT gen_random_uuid(),
  ALTER COLUMN attendance_identity_key SET NOT NULL;

ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS original_student_id INTEGER,
  ADD COLUMN IF NOT EXISTS identity_key UUID,
  ADD COLUMN IF NOT EXISTS student_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS student_code_snapshot VARCHAR(50);

UPDATE attendance_records ar
SET original_student_id = s.id,
    identity_key = s.attendance_identity_key,
    student_name_snapshot = s.name,
    student_code_snapshot = s.digital_student_id
FROM students s
WHERE ar.student_id = s.id
  AND ar.school_id = s.school_id
  AND (
    ar.original_student_id IS NULL
    OR ar.identity_key IS NULL
    OR ar.student_name_snapshot IS NULL
    OR ar.student_code_snapshot IS NULL
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM attendance_records
    WHERE original_student_id IS NULL
       OR identity_key IS NULL
       OR student_name_snapshot IS NULL
       OR student_code_snapshot IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot preserve attendance identity: one or more records have no same-school student';
  END IF;
END
$$;

ALTER TABLE attendance_records
  ALTER COLUMN original_student_id SET NOT NULL,
  ALTER COLUMN identity_key SET NOT NULL,
  ALTER COLUMN student_name_snapshot SET NOT NULL,
  ALTER COLUMN student_code_snapshot SET NOT NULL;

ALTER TABLE attendance_records
  ALTER COLUMN student_id DROP NOT NULL;

ALTER TABLE attendance_records
  DROP CONSTRAINT IF EXISTS attendance_records_student_id_students_id_fk;

ALTER TABLE attendance_records
  ADD CONSTRAINT attendance_records_student_id_students_id_fk
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL;

DROP INDEX IF EXISTS attendance_records_canonical_identity_uidx;
CREATE UNIQUE INDEX IF NOT EXISTS attendance_records_canonical_identity_uidx
  ON attendance_records (school_id, session_id, identity_key, date);

CREATE OR REPLACE FUNCTION attendance_records_fill_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  matched_student students%ROWTYPE;
BEGIN
  IF NEW.student_id IS NULL THEN
    RAISE EXCEPTION 'attendance_records.student_id is required when inserting an attendance record';
  END IF;

  SELECT s.*
  INTO matched_student
  FROM students s
  WHERE s.id = NEW.student_id
    AND s.school_id = NEW.school_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'attendance student % does not belong to school %',
      NEW.student_id, NEW.school_id;
  END IF;

  NEW.original_student_id := matched_student.id;
  NEW.identity_key := matched_student.attendance_identity_key;
  NEW.student_name_snapshot := matched_student.name;
  NEW.student_code_snapshot := matched_student.digital_student_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION attendance_records_preserve_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.original_student_id := OLD.original_student_id;
  NEW.identity_key := OLD.identity_key;
  NEW.student_name_snapshot := OLD.student_name_snapshot;
  NEW.student_code_snapshot := OLD.student_code_snapshot;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attendance_records_fill_identity_trigger ON attendance_records;
CREATE TRIGGER attendance_records_fill_identity_trigger
BEFORE INSERT ON attendance_records
FOR EACH ROW
EXECUTE FUNCTION attendance_records_fill_identity();

DROP TRIGGER IF EXISTS attendance_records_preserve_identity_trigger ON attendance_records;
CREATE TRIGGER attendance_records_preserve_identity_trigger
BEFORE UPDATE ON attendance_records
FOR EACH ROW
EXECUTE FUNCTION attendance_records_preserve_identity();

COMMIT;