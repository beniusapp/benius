BEGIN;

-- This migration is deliberately safe to rerun.  It is also the repair path
-- for databases on which 014 has already been applied.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM attendance_records
    WHERE (CASE WHEN original_student_id IS NULL THEN 1 ELSE 0 END)
        + (CASE WHEN identity_key IS NULL THEN 1 ELSE 0 END)
        + (CASE WHEN student_name_snapshot IS NULL THEN 1 ELSE 0 END)
        + (CASE WHEN student_code_snapshot IS NULL THEN 1 ELSE 0 END)
      BETWEEN 1 AND 3
  ) THEN
    RAISE EXCEPTION 'Cannot enforce attendance identity: partially populated identity state';
  END IF;
  IF EXISTS (SELECT 1 FROM attendance_records
             WHERE original_student_id IS NULL OR identity_key IS NULL
                OR student_name_snapshot IS NULL OR student_code_snapshot IS NULL
                OR btrim(student_name_snapshot) = '' OR btrim(student_code_snapshot) = '') THEN
    RAISE EXCEPTION 'Cannot enforce attendance identity: empty or missing historical identity';
  END IF;
  IF EXISTS (
    SELECT 1 FROM attendance_records ar
    WHERE ar.student_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM students s WHERE s.id = ar.student_id)
  ) THEN
    RAISE EXCEPTION 'Cannot enforce attendance identity: attendance student is missing or cross-school';
  END IF;
  IF EXISTS (
    SELECT 1 FROM attendance_records ar JOIN students s ON s.id = ar.student_id
    WHERE ar.school_id <> s.school_id OR ar.original_student_id <> s.id
       OR ar.identity_key <> s.attendance_identity_key
  ) THEN
    RAISE EXCEPTION 'Cannot enforce attendance identity: contradictory live student identity';
  END IF;
  IF EXISTS (
    SELECT school_id, session_id, identity_key, date
    FROM attendance_records GROUP BY school_id, session_id, identity_key, date
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce attendance identity: duplicate canonical identity';
  END IF;
  IF EXISTS (
    SELECT identity_key FROM attendance_records
    GROUP BY identity_key
    HAVING count(DISTINCT (school_id, original_student_id)) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce attendance identity: cross-identity key collision';
  END IF;
  IF EXISTS (
    SELECT 1 FROM students s
    JOIN attendance_records ar ON ar.identity_key = s.attendance_identity_key
    WHERE ar.original_student_id <> s.id OR ar.school_id <> s.school_id
  ) THEN
    RAISE EXCEPTION 'Cannot enforce attendance identity: live student conflicts with orphan history';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS students_attendance_identity_key_uidx
  ON students (attendance_identity_key);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_records_canonical_identity_uidx
  ON attendance_records (school_id, session_id, identity_key, date);

CREATE TABLE IF NOT EXISTS attendance_identity_reservations (
  identity_key UUID PRIMARY KEY
);

INSERT INTO attendance_identity_reservations (identity_key)
SELECT attendance_identity_key FROM students
ON CONFLICT DO NOTHING;
INSERT INTO attendance_identity_reservations (identity_key)
SELECT identity_key FROM attendance_records
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION reserve_student_attendance_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO attendance_identity_reservations(identity_key)
  VALUES (NEW.attendance_identity_key);
  RETURN NEW;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'attendance identity key % has already been reserved', NEW.attendance_identity_key;
END
$$;
CREATE OR REPLACE FUNCTION reject_student_attendance_identity_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.attendance_identity_key IS DISTINCT FROM OLD.attendance_identity_key THEN
    RAISE EXCEPTION 'students.attendance_identity_key is immutable';
  END IF;
  RETURN NEW;
END
$$;
CREATE OR REPLACE FUNCTION reject_attendance_identity_reservation_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'attendance identity reservations are immutable';
END
$$;

DROP TRIGGER IF EXISTS students_reserve_attendance_identity_trigger ON students;
CREATE TRIGGER students_reserve_attendance_identity_trigger
BEFORE INSERT ON students FOR EACH ROW
EXECUTE FUNCTION reserve_student_attendance_identity();
DROP TRIGGER IF EXISTS students_immutable_attendance_identity_trigger ON students;
CREATE TRIGGER students_immutable_attendance_identity_trigger
BEFORE UPDATE OF attendance_identity_key ON students FOR EACH ROW
EXECUTE FUNCTION reject_student_attendance_identity_change();
DROP TRIGGER IF EXISTS attendance_identity_reservations_immutable_trigger
  ON attendance_identity_reservations;
CREATE TRIGGER attendance_identity_reservations_immutable_trigger
BEFORE UPDATE OR DELETE ON attendance_identity_reservations FOR EACH ROW
EXECUTE FUNCTION reject_attendance_identity_reservation_change();

CREATE OR REPLACE FUNCTION attendance_records_preserve_identity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.student_id IS DISTINCT FROM OLD.student_id
     AND (OLD.student_id IS NULL OR NEW.student_id IS NOT NULL) THEN
    RAISE EXCEPTION 'attendance_records.student_id cannot be reassigned';
  END IF;
  NEW.original_student_id := OLD.original_student_id;
  NEW.identity_key := OLD.identity_key;
  NEW.student_name_snapshot := OLD.student_name_snapshot;
  NEW.student_code_snapshot := OLD.student_code_snapshot;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS attendance_records_preserve_identity_trigger ON attendance_records;
CREATE TRIGGER attendance_records_preserve_identity_trigger BEFORE UPDATE ON attendance_records
FOR EACH ROW EXECUTE FUNCTION attendance_records_preserve_identity();

COMMIT;