CREATE UNIQUE INDEX IF NOT EXISTS students_id_school_uniq
  ON students (id, school_id);

CREATE TABLE IF NOT EXISTS student_verified_recovery_contacts (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL,
  contact_type VARCHAR(20) NOT NULL DEFAULT 'email',
  contact_value VARCHAR(255) NOT NULL,
  contact_value_normalized VARCHAR(255) NOT NULL,
  verified_at TIMESTAMPTZ,
  verification_method VARCHAR(30),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT student_verified_contacts_email_only_chk CHECK (contact_type = 'email'),
  CONSTRAINT student_verified_contacts_student_tenant_fk
    FOREIGN KEY (student_id, school_id) REFERENCES students(id, school_id) ON DELETE CASCADE,
  UNIQUE (student_id, contact_type)
);
CREATE INDEX IF NOT EXISTS student_verified_contacts_school_student_idx
  ON student_verified_recovery_contacts (school_id, student_id);
CREATE UNIQUE INDEX IF NOT EXISTS student_verified_contacts_tenant_identity_uniq
  ON student_verified_recovery_contacts (id, student_id, school_id);

CREATE TABLE IF NOT EXISTS student_recovery_contact_verification_challenges (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL,
  contact_id INTEGER NOT NULL,
  purpose VARCHAR(40) NOT NULL DEFAULT 'student_recovery_email_verification',
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_ip TEXT,
  CONSTRAINT student_recovery_verification_student_tenant_fk
    FOREIGN KEY (student_id, school_id) REFERENCES students(id, school_id) ON DELETE CASCADE,
  CONSTRAINT student_recovery_verification_contact_tenant_fk
    FOREIGN KEY (contact_id, student_id, school_id)
    REFERENCES student_verified_recovery_contacts(id, student_id, school_id) ON DELETE CASCADE,
  CONSTRAINT student_recovery_verification_purpose_chk
    CHECK (purpose = 'student_recovery_email_verification'),
  CONSTRAINT student_recovery_verification_attempts_chk
    CHECK (attempt_count >= 0 AND attempt_count <= 5)
);
CREATE INDEX IF NOT EXISTS student_recovery_verification_school_student_idx
  ON student_recovery_contact_verification_challenges (school_id, student_id);
CREATE INDEX IF NOT EXISTS student_recovery_verification_active_idx
  ON student_recovery_contact_verification_challenges (school_id, student_id, contact_id, consumed_at);