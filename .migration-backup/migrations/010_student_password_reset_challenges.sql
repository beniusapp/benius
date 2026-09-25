CREATE TABLE IF NOT EXISTS student_password_reset_challenges (
  id SERIAL PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL,
  contact_id INTEGER NOT NULL,
  purpose VARCHAR(40) NOT NULL DEFAULT 'student_password_recovery',
  otp_hash TEXT NOT NULL,
  otp_expires_at TIMESTAMPTZ NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  verified_at TIMESTAMPTZ,
  reset_token_hash TEXT,
  reset_token_expires_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_ip TEXT,
  CONSTRAINT student_password_reset_student_tenant_fk
    FOREIGN KEY (student_id, school_id) REFERENCES students(id, school_id) ON DELETE CASCADE,
  CONSTRAINT student_password_reset_contact_tenant_fk
    FOREIGN KEY (contact_id, student_id, school_id)
    REFERENCES student_verified_recovery_contacts(id, student_id, school_id) ON DELETE CASCADE,
  CONSTRAINT student_password_reset_purpose_chk
    CHECK (purpose = 'student_password_recovery'),
  CONSTRAINT student_password_reset_attempts_chk
    CHECK (attempt_count >= 0 AND attempt_count <= 5)
);

CREATE INDEX IF NOT EXISTS student_password_reset_school_student_idx
  ON student_password_reset_challenges (school_id, student_id);
CREATE INDEX IF NOT EXISTS student_password_reset_active_idx
  ON student_password_reset_challenges (school_id, student_id, consumed_at);
CREATE INDEX IF NOT EXISTS student_password_reset_expiry_idx
  ON student_password_reset_challenges (otp_expires_at, reset_token_expires_at);